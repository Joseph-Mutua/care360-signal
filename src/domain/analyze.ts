import { RULES } from '../config/rules';
import { dateKey, parseMessages, parseOperationalEvents, parseReports } from '../parsers/whatsapp';
import type { ActionItem, Aggregate, Analysis, ExpectedSlot, OperationalEvent, QualityFlag, RawMessage, Report, Shift } from './types';

const minute = 60_000;
const day = 24 * 60 * minute;
const pct = (n: number, d: number) => d ? Math.round(n / d * 1000) / 10 : 0;
const key = (at: number) => new Date(at).toISOString().slice(0, 10);

function expectedCaregiver(client: string, shift: Shift, due: number, events: OperationalEvent[]): string {
  const roster = RULES.roster[shift] as Record<string, string>;
  const cover = events.find(e => e.type === 'coverage' && e.client === client && e.caregiver && e.endDate && due > e.at && key(due) <= e.endDate && key(due) > key(e.at));
  return cover?.caregiver ?? roster[client] ?? 'Unassigned';
}

export function generateSchedule(events: OperationalEvent[]): ExpectedSlot[] {
  const slots: ExpectedSlot[] = [];
  const first = Date.parse(`${RULES.periodStart}T00:00:00Z`);
  const last = Date.parse(`${RULES.periodEnd}T00:00:00Z`);
  for (let base = first; base <= last; base += day) {
    const start = key(base);
    for (const client of RULES.dayClients) for (const time of RULES.dayHours) {
      const due = Date.parse(`${start}T${time}:00Z`);
      slots.push({ id: `${client}-${start}-${time}`, client, shift: 'day', time, due, caregiver: expectedCaregiver(client, 'day', due, events), paused: false });
    }
    if (start <= RULES.lastNightStart) for (const client of RULES.nightClients) for (const time of RULES.nightHours) {
      const next = time < '07:00' ? base + day : base;
      const due = Date.parse(`${key(next)}T${time}:00Z`);
      slots.push({ id: `${client}-${key(next)}-${time}`, client, shift: 'night', time, due, caregiver: expectedCaregiver(client, 'night', due, events), paused: false });
    }
  }
  for (const slot of slots) {
    const past = events.filter(e => e.client === slot.client && (e.type === 'pause' || e.type === 'resume') && e.at <= slot.due).sort((a, b) => a.at - b.at);
    if (past.at(-1)?.type === 'pause') {
      slot.paused = true;
      slot.pauseEvidence = past.at(-1)?.messageId;
    }
  }
  return slots;
}

function addFlag(report: Report, flag: QualityFlag, reason: string) {
  if (!report.flags.includes(flag)) { report.flags.push(flag); report.flagReasons.push(reason); }
}

function matchReports(reports: Report[], slots: ExpectedSlot[]) {
  const byClientTime = new Map<string, ExpectedSlot[]>();
  for (const slot of slots) {
    const k = `${slot.client}|${slot.time}`;
    byClientTime.set(k, [...(byClientTime.get(k) ?? []), slot]);
  }
  for (const report of reports) {
    const matches = byClientTime.get(`${report.client}|${report.statedTime}`) ?? [];
    const eligible = matches.filter(s => Math.abs(s.due - report.sentAt) <= 8 * 60 * minute).sort((a, b) => Math.abs(a.due - report.sentAt) - Math.abs(b.due - report.sentAt));
    const slot = eligible[0];
    if (!slot || slot.paused) { addFlag(report, 'OUTSIDE_EXPECTED_SCHEDULE', slot?.paused ? 'Care was officially paused at this due time.' : 'No configured slot matches this client, stated time and send date.'); continue; }
    report.slotId = slot.id;
    report.due = slot.due;
    report.shift = slot.shift;
    report.minutesFromDue = Math.round((report.sentAt - slot.due) / minute);
    report.onTime = Math.abs(report.minutesFromDue) <= RULES.onTimeMinutes;
    if (slot.caregiver.toLowerCase() !== report.sender.toLowerCase()) addFlag(report, 'UNEXPECTED_REPORTER', `Expected ${slot.caregiver} for this client and shift; message sender is ${report.sender}.`);
  }
  const bySlot = new Map<string, Report[]>();
  for (const report of reports) if (report.slotId) bySlot.set(report.slotId, [...(bySlot.get(report.slotId) ?? []), report]);
  for (const [id, group] of bySlot) {
    group.sort((a, b) => a.sentAt - b.sentAt);
    const primary = group[0];
    slots.find(s => s.id === id)!.reportId = primary.id;
    for (const later of group.slice(1)) {
      if (sameVitals(later, primary) && later.narrative.toLowerCase() === primary.narrative.toLowerCase() && later.sentAt - primary.sentAt <= RULES.duplicateMinutes * minute) {
        later.duplicateOf = primary.id;
        addFlag(later, 'DUPLICATE_REPORT', `Same client, slot, vitals and narrative as ${primary.id}, ${Math.round((later.sentAt - primary.sentAt) / minute)} minutes earlier.`);
      } else {
        addFlag(later, 'AMBIGUOUS_SLOT', `More than one non-identical report claims expected slot ${id}; earliest report is used for compliance.`);
      }
    }
  }
}

function sameVitals(a: Report, b: Report): boolean { return JSON.stringify(a.vitals) === JSON.stringify(b.vitals); }

function evaluateVitals(report: Report) {
  const v = report.vitals, p = RULES.plausible;
  report.complete = v.systolic !== undefined && v.diastolic !== undefined && v.pulse !== undefined && v.temperature !== undefined && v.temperatureUnit !== 'F' && v.spo2 !== undefined;
  if (!report.complete) addFlag(report, 'MISSING_VITALS', 'A complete report requires BP, pulse, Celsius temperature and SpO₂.');
  if (v.temperatureUnit === 'F') addFlag(report, 'UNEXPECTED_TEMPERATURE_UNIT', `Temperature ${v.temperature}°F was retained as entered; Celsius is required.`);
  if (v.systolic !== undefined && v.diastolic !== undefined && (v.systolic < p.systolicMin || v.systolic > p.systolicMax || v.diastolic < p.diastolicMin || v.diastolic > p.diastolicMax)) {
    report.dataIntegrityCritical = true;
    addFlag(report, 'IMPLAUSIBLE_BP', `BP ${v.systolic}/${v.diastolic} lies outside the configured plausibility range; validate against the caregiver.`);
  }
  if ((v.pulse !== undefined && (v.pulse < p.pulseMin || v.pulse > p.pulseMax)) || (v.spo2 !== undefined && (v.spo2 < p.spo2Min || v.spo2 > p.spo2Max)) || (v.temperature !== undefined && v.temperatureUnit !== 'F' && (v.temperature < p.tempMin || v.temperature > p.tempMax))) {
    report.dataIntegrityCritical = true;
    addFlag(report, 'IMPLAUSIBLE_VITAL', 'At least one vital lies outside its configured plausibility range; validate source measurement.');
  }
  if (report.dataIntegrityCritical) { report.escalation = 'INVALID_READING_REQUIRES_VALIDATION'; return; }
  if (v.systolic !== undefined && v.systolic >= RULES.abnormal.systolic || v.diastolic !== undefined && v.diastolic >= RULES.abnormal.diastolic) report.abnormal.push('BP ≥180 systolic or ≥110 diastolic');
  if (v.spo2 !== undefined && v.spo2 < RULES.abnormal.spo2Below) report.abnormal.push('SpO₂ <90%');
  if (v.temperature !== undefined && v.temperatureUnit !== 'F' && v.temperature >= RULES.abnormal.tempC) report.abnormal.push('Temperature ≥38.5°C');
}

function evaluateRepeated(reports: Report[]) {
  const groups = new Map<string, Report[]>();
  for (const r of reports.filter(r => r.slotId && !r.duplicateOf).sort((a, b) => a.sentAt - b.sentAt)) {
    const k = `${r.client}|${r.sender}|${r.shift}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const group of groups.values()) {
    let run: Report[] = [];
    for (const r of group) {
      const complete = r.vitals.systolic !== undefined && r.vitals.diastolic !== undefined && r.vitals.pulse !== undefined && r.vitals.temperature !== undefined && r.vitals.spo2 !== undefined;
      run = complete && run.length && sameVitals(r, run.at(-1)!) ? [...run, r] : complete ? [r] : [];
      if (run.length === RULES.repeatedVitalsCount) for (const member of run) addFlag(member, 'REPEATED_IDENTICAL_VITALS', `${run.length} consecutive identical vital sets for this caregiver/client/shift; verify measurement practice.`);
      if (run.length > RULES.repeatedVitalsCount) addFlag(r, 'REPEATED_IDENTICAL_VITALS', `${run.length} consecutive identical vital sets; verify measurement practice.`);
    }
  }
}

function evaluateEscalations(reports: Report[], messages: RawMessage[]) {
  const supervisor = messages.filter(m => /nurse supervisor/i.test(m.sender));
  for (const report of reports) {
    if (report.dataIntegrityCritical || !report.abnormal.length) continue;
    const candidates = supervisor.filter(m => m.at > report.sentAt && m.at - report.sentAt <= RULES.responseSearchMinutes * minute && (
      m.text.includes(report.client) || m.text.toLowerCase().includes(report.sender.toLowerCase()) || (report.vitals.systolic && report.vitals.diastolic && m.text.includes(`${report.vitals.systolic}/${report.vitals.diastolic}`))
    )).sort((a, b) => a.at - b.at);
    const response = candidates[0];
    if (response) {
      report.supervisorMessageId = response.id;
      report.supervisorMinutes = Math.round((response.at - report.sentAt) / minute);
      const followup = messages.find(m => m.at > response.at && m.at - response.at < 2 * 60 * minute && m.sender === report.sender && /recheck|improv/i.test(m.text) && (!/\bHC-\d{2}\b/i.test(m.text) || m.text.includes(report.client)));
      report.followupMessageId = followup?.id;
    }
    report.escalation = !report.tagged ? 'NOT_TAGGED' : !response ? 'NO_SUPERVISOR_RESPONSE' : report.supervisorMinutes! <= RULES.escalationMinutes ? 'ESCALATED_WITHIN_SLA' : 'ESCALATED_LATE';
  }
}

function aggregate(name: string, slots: ExpectedSlot[], reports: Report[]): Aggregate {
  const active = slots.filter(s => !s.paused);
  const chosen = active.map(s => reports.find(r => r.id === s.reportId)).filter((r): r is Report => !!r);
  return { name, expected: active.length, received: chosen.length, onTime: chosen.filter(r => r.onTime).length, complete: chosen.filter(r => r.complete).length, missing: active.length - chosen.length, late: chosen.filter(r => r.minutesFromDue !== undefined && r.minutesFromDue > RULES.onTimeMinutes).length, escalationIssues: chosen.filter(r => r.abnormal.length && r.escalation !== 'ESCALATED_WITHIN_SLA').length, quality: chosen.filter(r => r.flags.length).length };
}

function actions(slots: ExpectedSlot[], reports: Report[], messages: RawMessage[]): ActionItem[] {
  const result: ActionItem[] = [];
  for (const r of reports.filter(r => r.slotId && !r.duplicateOf && r.abnormal.length)) {
    result.push({ severity: r.escalation === 'ESCALATED_WITHIN_SLA' ? 'positive' : 'critical', title: r.escalation === 'ESCALATED_WITHIN_SLA' ? 'Escalation handled within SLA' : 'Abnormal reading needs escalation review', detail: `${r.client} · ${new Date(r.sentAt).toISOString().slice(0, 16).replace('T', ' ')} · ${r.abnormal.join(', ')} · ${r.tagged ? 'supervisor tagged' : 'supervisor not tagged'} · ${r.supervisorMinutes === undefined ? 'no matched response' : `${r.supervisorMinutes} min response`}`, reportId: r.id });
  }
  for (const r of reports.filter(r => r.dataIntegrityCritical)) result.push({ severity: 'critical', title: 'Critical validation required', detail: `${r.client} · ${r.sender} · ${r.flags.join(', ')} · source line ${messages.find(m => m.id === r.messageId)?.line}`, reportId: r.id });
  const missing = slots.filter(s => !s.paused && !s.reportId);
  for (const client of RULES.dayClients) {
    const group = missing.filter(s => s.client === client);
    if (group.length) result.push({ severity: 'high', title: `${client}: ${group.length} expected reports missing`, detail: `Most affected: ${Object.entries(Object.groupBy(group, s => s.time)).sort((a, b) => b[1]!.length - a[1]!.length).slice(0, 3).map(([time, list]) => `${time} (${list!.length})`).join(', ')}. Open the shift pulse for exact dates.`, slotId: group[0].id });
  }
  const late = reports.filter(r => r.slotId && !r.duplicateOf && r.minutesFromDue !== undefined && r.minutesFromDue > RULES.onTimeMinutes);
  if (late.length) result.push({ severity: 'review', title: `${late.length} late scheduled reports`, detail: late.map(r => `${r.client} ${dateKey(r.sentAt)} ${r.statedTime} (+${r.minutesFromDue}m)`).join('; '), reportId: late[0].id });
  const early = reports.filter(r => r.slotId && !r.duplicateOf && r.minutesFromDue !== undefined && r.minutesFromDue < -RULES.onTimeMinutes);
  if (early.length) result.push({ severity: 'review', title: `${early.length} reports outside the early window`, detail: early.map(r => `${r.client} ${dateKey(r.sentAt)} ${r.statedTime} (${r.minutesFromDue}m)`).join('; '), reportId: early[0].id });
  const incomplete = reports.filter(r => r.slotId && !r.duplicateOf && !r.complete);
  if (incomplete.length) result.push({ severity: 'review', title: `${incomplete.length} incomplete reports`, detail: 'At least one required BP, pulse, Celsius temperature or SpO₂ value is absent.', reportId: incomplete[0].id });
  const repeats = reports.filter(r => r.flags.includes('REPEATED_IDENTICAL_VITALS'));
  if (repeats.length) result.push({ severity: 'review', title: 'Repeated identical readings', detail: `${repeats.length} reports share a long consecutive vital pattern. Verify measurement practice.`, reportId: repeats[0].id });
  const rank = { critical: 0, high: 1, review: 2, positive: 3 };
  return result.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function analyze(input: string): Analysis {
  const { messages, warnings } = parseMessages(input);
  const events = parseOperationalEvents(messages);
  const reports = parseReports(messages);
  const slots = generateSchedule(events);
  matchReports(reports, slots);
  reports.forEach(evaluateVitals);
  evaluateRepeated(reports);
  evaluateEscalations(reports, messages);
  const active = slots.filter(s => !s.paused);
  const chosen = reports.filter(r => r.slotId && slots.find(s => s.id === r.slotId)?.reportId === r.id);
  const abnormal = chosen.filter(r => r.abnormal.length);
  const clients = RULES.dayClients.map(client => aggregate(client, slots.filter(s => s.client === client), reports));
  const caregiverNames = [...new Set(active.map(s => s.caregiver))];
  const caregivers = caregiverNames.map(name => aggregate(name, slots.filter(s => s.caregiver === name), reports));
  return { messages, reports, events, slots, clients, caregivers, actions: actions(slots, reports, messages), received: chosen.length, missing: active.length - chosen.length, late: chosen.filter(r => r.minutesFromDue !== undefined && r.minutesFromDue > RULES.onTimeMinutes).length, validAbnormal: abnormal.length, warnings,
    kpis: { completion: pct(chosen.length, active.length), onTime: pct(chosen.filter(r => r.onTime).length, active.length), completeVitals: pct(chosen.filter(r => r.complete).length, chosen.length), escalation: pct(abnormal.filter(r => r.escalation === 'ESCALATED_WITHIN_SLA').length, abnormal.length), quality: pct(chosen.filter(r => r.flags.length).length, chosen.length) } };
}
