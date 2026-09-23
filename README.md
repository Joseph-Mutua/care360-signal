# Care360 Signal

An assessment prototype for turning a messy homecare WhatsApp export into an auditable operations view. It identifies expected and missing reports, timeliness, complete vitals, abnormal readings, escalation handling and data-quality concerns. Every report and decision links back to the source message or the schedule rule that produced it.

## Run

Requires Node.js 20 or newer. From this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The supplied synthetic sample loads automatically. Choose **Import export** or drop another WhatsApp `.txt` file to analyze it; **Load sample** restores the fixture and **Reset dataset** clears it. The **CSV** button exports normalized report rows. `/analysis` is a two-page printable report and `/team-plan` is a one-page printable delivery plan.

Validation:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Architecture

`src/parsers/whatsapp.ts` splits timestamp-prefixed messages, appends continuation lines, parses report variants and keeps raw source text, sender and line number. `src/domain/analyze.ts` generates the expected schedule and applies pause, matching, duplicate, vital, escalation and quality rules. `src/config/rules.ts` holds editable thresholds, coverage and roster assumptions. The browser uses `FileReader` and runs the pure analysis function locally. React components render derived results without reparsing on routine interaction.

No upload API or database is present in this prototype. The supplied export is synthetic and included as a local sample. New files remain in browser memory; the app does not transmit them to a server. CSV export is created locally.

## Business interpretation

- Day reports: 07:00, 11:00, 15:00 on 7–20 September 2026 for HC-01–05. Night reports: 18:00 through 06:00 every two hours on nights starting 7–19 September for HC-01–03.
- A report's **stated slot** chooses the expected slot. The WhatsApp send timestamp determines punctuality. “Within 30 minutes” is inclusive ±30 minutes. The first report for a scheduled slot supplies compliance; duplicates remain inspectable.
- The confirmed HC-05 hospitalization suspends five day slots from 12 September 16:46 to the 14 September 12:30 discharge. Paused slots do not penalize caregivers.
- Complete vitals require BP, pulse, Celsius temperature and SpO₂. An incomplete report still counts as received. Original values such as `1300/86` and `99.1F` are retained and flagged, never silently corrected.
- Valid abnormal thresholds: systolic BP ≥180 **or** diastolic ≥110, SpO₂ <90%, or temperature ≥38.5°C. The caregiver must tag the supervisor and a relevant supervisor response must occur within 15 minutes of the report. Unrelated group messages are excluded. Invalid extreme measurements are surfaced as **critical validation required** separately from valid clinical alerts.
- The roster is inferred from the sample's dominant client/shift pairings, with Faith W.'s HC-05 coverage on 18–19 September parsed from the manager message. Production must use Care360's official roster.
- Exact repeated vital tuples over a configured consecutive run are a neutral measurement-practice review prompt, not an allegation of misconduct. Parser limitations or unmatched schedules remain visible.

## Supplied sample findings

Under these rules, the target reconciliation is 478 active slots, 455 unique received, 23 missing and 3 late. HC-04's recurring 15:00 gap and HC-02's overnight gaps need management attention. On 15 September HC-01 BP 182/112 lacked a supervisor tag; a related response came about 192 minutes after the report. On 17 September HC-04 SpO₂ 88% was tagged and answered in about 8 minutes. The regression tests derive these values from the complete file. See `/analysis` for KPI definitions and prioritized findings.

## Live integration path

WhatsApp Business Cloud API → signature-verified webhook → encrypted raw event store with idempotency → queue and retry/dead-letter handling → parser/rule worker → operational database → role-scoped exception dashboard and supervisor notification. A separate SLA timer must monitor acknowledgments, with audit logs, minimum necessary data, retention/deletion policy, monitoring, secure transport and rollback procedures. The browser-only parser is a privacy-friendly prototype choice, not the proposed live architecture.

## Scope and next steps

The fixed assessment period, inferred roster and keyword-based mention matching are explicit prototype assumptions. Before production, confirm business rules with the nurse supervisor, integrate the official schedule and identity directory, add reconciliation for message edits/media, test live webhook retries and outages, and perform a security and clinical workflow review. The printable pages use the supplied sample; an imported file updates the interactive operations view.

AI-assisted development tools were used for implementation support and code review; business calculations and test results were checked against the supplied export.
