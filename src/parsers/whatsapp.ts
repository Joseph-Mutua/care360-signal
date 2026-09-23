import type { OperationalEvent, RawMessage, Report, VitalSet } from '../domain/types';

// UTC numbers represent the export's local wall clock. No browser timezone conversion occurs.
export function localTime(day: number, month: number, year: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}
export function dateKey(at: number): string { return new Date(at).toISOString().slice(0, 10); }
export function displayTime(at: number): string { return new Date(at).toISOString().slice(0, 16).replace('T', ' '); }

const prefix = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s+-\s+([^:]+):\s?(.*)$/;

export function parseMessages(input: string): { messages: RawMessage[]; warnings: string[] } {
  const messages: RawMessage[] = [];
  const warnings: string[] = [];
  let current: RawMessage | undefined;
  input.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
    const match = line.match(prefix);
    if (match) {
      current = { id: `m${messages.length + 1}`, at: localTime(+match[1], +match[2], +match[3], +match[4], +match[5]), sender: match[6].trim(), text: match[7], line: index + 1 };
      messages.push(current);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4},/.test(line)) {
      warnings.push(`Line ${index + 1}: malformed WhatsApp message prefix`);
      if (current) current.text += `\n${line}`;
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    } else if (line.trim() && !/^\d{1,2}\/\d{1,2}\/\d{4},/.test(line)) {
      warnings.push(`Line ${index + 1}: outside a parsed message`);
    }
  });
  return { messages, warnings };
}

export function parseOperationalEvents(messages: RawMessage[]): OperationalEvent[] {
  const events: OperationalEvent[] = [];
  for (const message of messages) {
    const client = message.text.match(/\bHC-\d{2}\b/i)?.[0].toUpperCase();
    if (!client) continue;
    const text = message.text;
    if (/pause shifts|reporting paused/i.test(text) && /supervisor|manager/i.test(message.sender)) {
      events.push({ id: `e${events.length + 1}`, type: 'pause', client, at: message.at, messageId: message.id });
    } else if (/discharged.*(?:resum|back home)|resum(?:ing|e).*report/i.test(text)) {
      events.push({ id: `e${events.length + 1}`, type: 'resume', client, at: message.at, messageId: message.id });
    } else {
      const cover = text.match(/\b([A-Z][a-z]+\s+[A-Z]\.)\s+will cover\s+(HC-\d{2}).*?(\d{1,2})(?:st|nd|rd|th)?\s+and\s+(\d{1,2})(?:st|nd|rd|th)?/i);
      if (cover) events.push({ id: `e${events.length + 1}`, type: 'coverage', client: cover[2].toUpperCase(), at: message.at, messageId: message.id, caregiver: cover[1], endDate: `2026-09-${cover[4].padStart(2, '0')}`, });
    }
  }
  return events;
}

export function parseVitals(text: string): VitalSet {
  const bp = text.match(/\bBP\s*[:=]?\s*(\d{2,4})\s*\/\s*(\d{2,3})\b/i);
  const pulse = text.match(/\b(?:pulse|HR|P)\s*[:=]?\s*(\d{1,3})\b/i);
  const temperature = text.match(/\b(?:temp(?:erature)?|T)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*°?\s*([CF])?\b/i);
  const spo2 = text.match(/\b(?:SpO\s*2|oxygen\s*saturation)\s*[:=]?\s*(\d{1,3})\s*%?/i);
  return {
    systolic: bp ? +bp[1] : undefined,
    diastolic: bp ? +bp[2] : undefined,
    pulse: pulse ? +pulse[1] : undefined,
    temperature: temperature ? +temperature[1] : undefined,
    temperatureUnit: temperature ? (temperature[2]?.toUpperCase() as 'C' | 'F' | undefined) ?? 'unspecified' : undefined,
    spo2: spo2 ? +spo2[1] : undefined,
  };
}

function statedTime(text: string): string | undefined {
  const m = text.match(/\b(?:HC-\d{2}\s*\|\s*|report\s+)(\d{1,2}):(\d{2})\b/i)
    ?? text.match(/\b(\d{2})(\d{2})\s*hrs\b/i);
  if (!m) return undefined;
  const hour = +m[1], minute = +m[2];
  return hour < 24 && minute < 60 ? `${String(hour).padStart(2, '0')}:${m[2]}` : undefined;
}

export function parseReports(messages: RawMessage[]): Report[] {
  const reports: Report[] = [];
  for (const message of messages) {
    const client = message.text.match(/\bHC-\d{2}\b/i)?.[0].toUpperCase();
    if (!client || /\brecheck\b/i.test(message.text)) continue;
    const slot = statedTime(message.text);
    if (!slot && !/\breport\b|\|/.test(message.text.toLowerCase())) continue;
    const vitals = parseVitals(message.text);
    const narrative = message.text
      .replace(/\bHC-\d{2}\b\s*(?:\|\s*)?/ig, '')
      .replace(/\b(?:\d{1,2}:\d{2}|\d{4}hrs)\s*(?:\|\s*)?\s*report\.?|\breport\s*\d{1,2}:\d{2}|\b\d{1,2}:\d{2}\s*\|/ig, '')
      .replace(/\bBP\s*[:=]?\s*\d{2,4}\s*\/\s*\d{2,3}\b/ig, '')
      .replace(/\b(?:pulse|HR|P)\s*[:=]?\s*\d{1,3}\b/ig, '')
      .replace(/\b(?:temp(?:erature)?|T)\s*[:=]?\s*\d{2,3}(?:\.\d+)?\s*°?\s*[CF]?\b/ig, '')
      .replace(/\b(?:SpO\s*2|oxygen\s*saturation)\s*[:=]?\s*\d{1,3}\s*%?/ig, '')
      .replace(/^[\s|.,]+|[\s|.,]+$/g, '').replace(/\s+/g, ' ');
    reports.push({ id: `r${reports.length + 1}`, messageId: message.id, sentAt: message.at, sender: message.sender, client, statedTime: slot, vitals, narrative, flags: slot ? [] : ['AMBIGUOUS_SLOT', 'PARSE_WARNING'], flagReasons: slot ? [] : ['No valid stated reporting time could be parsed.', 'Report-like message retained without a recognized slot.'], complete: false, abnormal: [], dataIntegrityCritical: false, escalation: 'NO_ESCALATION_REQUIRED', tagged: /@\s*Lilian\b|@\s*nurse\s*supervisor\b/i.test(message.text) });
  }
  return reports;
}
