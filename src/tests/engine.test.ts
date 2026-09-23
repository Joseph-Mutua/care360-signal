import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, generateSchedule } from '../domain/analyze';
import { parseMessages, parseOperationalEvents, parseReports, parseVitals } from '../parsers/whatsapp';

const raw = (line: string) => parseMessages(line).messages;

describe('WhatsApp intake', () => {
  it('keeps multiline messages together with source line and sender', () => {
    const messages = raw('07/09/2026, 07:06 - Cynthia W.: HC-02 report 07:00\nBP 125/85\nPulse 71\nTemp 36.8\nSpO2 97%\n07/09/2026, 07:10 - Tom: noted');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ sender: 'Cynthia W.', line: 1 });
    expect(parseReports(messages)[0].vitals).toMatchObject({ systolic: 125, diastolic: 85, pulse: 71, temperature: 36.8, spo2: 97 });
  });
  it('retains malformed prefix warnings without losing later messages', () => {
    const parsed = parseMessages('07/09/2026, 07:00 - Achieng O.: HC-01 | 07:00 | BP 120/80\n08/09/2026, broken - unknown\n08/09/2026, 07:00 - Achieng O.: HC-01 | 07:00 | BP 120/80');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.warnings[0]).toContain('Line 2');
  });
  it('accepts single-line formats and preserves abnormal raw values', () => {
    const reports = parseReports(raw('07/09/2026, 06:56 - Susan J.: HC-05 0700hrs report. Bp 1300/86 pulse 74 temp 99.1F spo2 98%'));
    expect(reports[0].statedTime).toBe('07:00');
    expect(reports[0].vitals).toMatchObject({ systolic: 1300, temperature: 99.1, temperatureUnit: 'F' });
    expect(parseVitals('HC-03 | 07:00 | BP 120/80, P 72, T 36.5, SpO2 98')).toMatchObject({ pulse: 72, temperature: 36.5, spo2: 98 });
    expect(parseReports(raw('08/09/2026, 11:09 - Susan J.: HC-05 1100hrs. Client ok, slept after lunch.'))[0]).toMatchObject({ statedTime: '11:00', client: 'HC-05' });
  });
  it('generates midnight slots on the next calendar date', () => {
    const slots = generateSchedule([]);
    expect(slots.find(s => s.client === 'HC-01' && s.id === 'HC-01-2026-09-08-00:00')?.shift).toBe('night');
    expect(slots).toHaveLength(483);
  });
  it('applies a confirmed pause and temporary coverage', () => {
    const events = parseOperationalEvents(raw('12/09/2026, 16:46 - Lilian (Nurse Supervisor): @Tom HC-05 admitted, pause shifts until discharge.\n14/09/2026, 12:30 - Susan J.: HC-05 client discharged and back home 12:30. Resuming reports.\n17/09/2026, 17:05 - Tom (Caregiver Manager): FYI Faith W. will cover HC-05 day shift 18th and 19th, Susan on leave.'));
    const slots = generateSchedule(events);
    expect(slots.filter(s => s.paused)).toHaveLength(5);
    expect(slots.find(s => s.id === 'HC-05-2026-09-18-07:00')?.caregiver).toBe('Faith W.');
  });
});

describe('clinical and timing rules', () => {
  const one = (time: string, text: string) => analyze(`07/09/2026, ${time} - Achieng O.: HC-01 | 07:00 | ${text}`);
  it('includes the 30-minute boundary and excludes 31 minutes', () => {
    expect(one('07:30', 'BP 120/80, P 72, T 36.5, SpO2 98').reports[0].onTime).toBe(true);
    expect(one('07:31', 'BP 120/80, P 72, T 36.5, SpO2 98').reports[0].onTime).toBe(false);
    expect(one('06:30', 'BP 120/80, P 72, T 36.5, SpO2 98').reports[0].onTime).toBe(true);
    const early = one('06:29', 'BP 120/80, P 72, T 36.5, SpO2 98');
    expect(early.reports[0].onTime).toBe(false);
    expect(early.late).toBe(0);
    expect(early.actions.some(a => a.title.includes('early window'))).toBe(true);
  });
  it('separates incomplete, abnormal and critical invalid readings', () => {
    expect(one('07:00', 'BP 120/80, P 72, T 36.5').reports[0].flags).toContain('MISSING_VITALS');
    expect(one('07:00', 'BP 182/112, P 72, T 36.5, SpO2 98').reports[0].abnormal).toContain('BP ≥180 systolic or ≥110 diastolic');
    expect(one('07:00', 'BP 120/80, P 72, T 38.5, SpO2 89').reports[0].abnormal).toHaveLength(2);
    expect(one('07:00', 'BP 1300/86, P 72, T 36.5, SpO2 98').reports[0]).toMatchObject({ dataIntegrityCritical: true, escalation: 'INVALID_READING_REQUIRES_VALIDATION' });
    expect(one('07:00', 'BP 120/80, P 72, T 99.1F, SpO2 98').reports[0].flags).toContain('UNEXPECTED_TEMPERATURE_UNIT');
  });
  it('keeps duplicate evidence without double-counting', () => {
    const result = analyze('07/09/2026, 07:00 - Achieng O.: HC-01 | 07:00 | BP 120/80, P 72, T 36.5, SpO2 98. Well.\n07/09/2026, 07:01 - Achieng O.: HC-01 | 07:00 | BP 120/80, P 72, T 36.5, SpO2 98. Well.');
    expect(result.received).toBe(1);
    expect(result.reports[1].flags).toContain('DUPLICATE_REPORT');
  });
  it('matches context-specific supervisor responses and times the report-to-response SLA', () => {
    const input = '07/09/2026, 07:00 - Achieng O.: HC-01 | 07:00 | BP 182/112, P 72, T 36.5, SpO2 98. @Lilian escalating.\n07/09/2026, 07:08 - Lilian (Nurse Supervisor): @Achieng O. noted, recheck BP 182/112.\n07/09/2026, 11:00 - Achieng O.: HC-01 | 11:00 | BP 182/112, P 72, T 36.5, SpO2 98. @Lilian escalating.';
    const result = analyze(input);
    expect(result.reports[0]).toMatchObject({ escalation: 'ESCALATED_WITHIN_SLA', supervisorMinutes: 8 });
    expect(result.reports[1].escalation).toBe('NO_SUPERVISOR_RESPONSE');
    expect(analyze(input.replace('@Lilian escalating.', 'Escalating.')).reports[0].escalation).toBe('NOT_TAGGED');
    expect(analyze(input.replace('07:08 - Lilian', '07:16 - Lilian')).reports[0]).toMatchObject({ escalation: 'ESCALATED_LATE', supervisorMinutes: 16 });
  });
});

describe('supplied export regression', () => {
  const data = readFileSync('Sample_Homecare_WhatsApp_Export.txt', 'utf8');
  const result = analyze(data);
  it('derives the scheduled totals, not sample constants', () => {
    expect(result.slots.filter(s => !s.paused)).toHaveLength(478);
    expect(result.received).toBe(455);
    expect(result.missing).toBe(23);
    expect(result.late).toBe(3);
    expect(result.clients.map(c => [c.expected, c.received, c.onTime])).toEqual([[133, 133, 130], [133, 120, 120], [133, 133, 133], [42, 32, 32], [37, 37, 37]]);
  });
  it('preserves key clinical and data quality evidence', () => {
    expect(result.reports.some(r => r.vitals.systolic === 1300 && r.flags.includes('IMPLAUSIBLE_BP'))).toBe(true);
    expect(result.reports.some(r => r.vitals.temperature === 99.1 && r.flags.includes('UNEXPECTED_TEMPERATURE_UNIT'))).toBe(true);
    expect(result.reports.some(r => r.flags.includes('DUPLICATE_REPORT'))).toBe(true);
    expect(result.reports.some(r => r.flags.includes('REPEATED_IDENTICAL_VITALS'))).toBe(true);
    expect(result.reports.find(r => r.client === 'HC-01' && r.vitals.systolic === 182)).toMatchObject({ supervisorMinutes: 192, followupMessageId: expect.any(String) });
    expect(result.reports.find(r => r.client === 'HC-04' && r.vitals.spo2 === 88)).toMatchObject({ supervisorMinutes: 8, followupMessageId: expect.any(String) });
  });
});
