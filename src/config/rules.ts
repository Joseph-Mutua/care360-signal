export const RULES = {
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  lastNightStart: '2026-09-19',
  dayHours: ['07:00', '11:00', '15:00'],
  nightHours: ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'],
  dayClients: ['HC-01', 'HC-02', 'HC-03', 'HC-04', 'HC-05'],
  nightClients: ['HC-01', 'HC-02', 'HC-03'],
  onTimeMinutes: 30,
  escalationMinutes: 15,
  duplicateMinutes: 5,
  responseSearchMinutes: 360,
  repeatedVitalsCount: 5,
  abnormal: { systolic: 180, diastolic: 110, spo2Below: 90, tempC: 38.5 },
  plausible: { systolicMin: 50, systolicMax: 300, diastolicMin: 30, diastolicMax: 200, pulseMin: 30, pulseMax: 220, tempMin: 30, tempMax: 43, spo2Min: 50, spo2Max: 100 },
  roster: {
    day: { 'HC-01': 'Achieng O.', 'HC-02': 'Cynthia W.', 'HC-03': 'Grace M.', 'HC-04': 'Mercy N.', 'HC-05': 'Susan J.' },
    night: { 'HC-01': 'Brian K.', 'HC-02': 'Peter O.', 'HC-03': 'Dennis K.' }
  }
} as const;
