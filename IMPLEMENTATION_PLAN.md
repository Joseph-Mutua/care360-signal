# Care360 Signal implementation plan

## Source and model

The practical brief defines the rules. The WhatsApp export is the audit source. The Stitch project supplies the visual language (compact telemetry panels, teal/sky/rose palette, Space Grotesk headings, Inter copy, prominent alert area and bottom navigation), but its sample names and numbers are illustrative and conflict with the export.

`RawMessage` retains sender, timestamp, line number and full text. `Report` references one raw message, stores observed vital values and original temperature unit, a stated slot, matched expected slot, flags, clinical findings and escalation links. `ExpectedSlot` is generated from coverage and dates, with explicit pause evidence. `OperationalEvent` records pause, resume and coverage changes. Derived `Analysis` contains KPIs, client and caregiver aggregates, exception queues and evidence references.

## Rules and assumptions

The day shift has 07:00, 11:00 and 15:00 slots from 7–20 September 2026. Night shifts start 7–19 September, with 18:00, 20:00, 22:00, 00:00, 02:00, 04:00 and 06:00 slots. HC-01–03 have both shifts; HC-04–05 have day shifts only. A stated report slot chooses its expected slot; its WhatsApp timestamp measures punctuality. “Within 30 minutes” means inclusive ±30 minutes. A received report counts even if its vitals are incomplete. Exact duplicates stay in the audit trail and count once.

HC-05's supervisor-confirmed pause starts 12 September 16:46 and ends on discharge 14 September 12:30. Five due slots are excluded. The dominant caregiver roster is an assumption inferred from the sample, with Faith W.'s 18–19 September HC-05 coverage read as an event. A production system must use the official roster. The configured period remains fixed for the assessment; imports outside it retain messages and receive schedule warnings.

For valid abnormal vitals, a caregiver mention of the nurse supervisor is the escalation tag. A supervisor response must refer to the client, caregiver or reported abnormal value and follow the report. The response clock starts at the abnormal report timestamp. Unrelated group reminders are excluded. Implausible measurements require validation and are not automatically promoted into valid clinical alerts.

## Pipeline

1. Split WhatsApp messages on timestamp/sender prefixes and append continuation lines.
2. Parse reports, vital signs and operational events without changing raw values.
3. Generate expected slots, then mark confirmed paused slots.
4. Match by client and stated slot, retain unassigned and duplicate messages.
5. Apply timeliness, completeness, clinical, escalation and data-quality rules.
6. Aggregate by client, assigned caregiver and slot; keep raw-message references throughout.

All parsing and analysis runs in the browser after `FileReader`; the file is not uploaded. The pure domain function can later be called from a worker or API.

## UI map and verification

The two-minute view uses a Stitch-inspired headline and alert panel, five defined KPIs, priority action queue, client telemetry matrix and a shift pulse. Separate views expose reports, escalations, data trust, and client/caregiver performance. An evidence drawer displays each source message and rule explanation. Printable `/analysis` and `/team-plan` routes complete the brief.

Vitest covers parsing formats, date boundaries, pause and replacement coverage, duplicate and quality rules, abnormal escalation linking, and full-file regression totals. TypeScript, lint and build checks follow. Browser checks cover sample loading, a new file upload, evidence drill-down, print routes and responsive layout.
