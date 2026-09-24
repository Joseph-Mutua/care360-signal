# Architecture and live-change notes

The implementation is deliberately a small pure pipeline: `parseMessages` → `parseOperationalEvents` / `parseReports` → `generateSchedule` → matching and deterministic rules → aggregates and actions. Every report retains `messageId`; every missing slot retains its generated due time and any pause evidence. The React UI consumes one `Analysis` object. `FileReader` keeps imported data in browser memory.

Change the following in [`src/config/rules.ts`](src/config/rules.ts):

| Interview change | Setting |
| --- | --- |
| Reporting schedule | `dayHours`, `nightHours`, `periodStart`, `periodEnd`, `lastNightStart` |
| 30-minute tolerance | `onTimeMinutes` |
| 15-minute escalation SLA | `escalationMinutes` |
| Abnormal vital thresholds | `abnormal` |
| Client coverage | `dayClients`, `nightClients` |
| Caregiver assumptions | `roster`; temporary changes are parsed events |
| Quality thresholds | `plausible`, `repeatedVitalsCount`, `duplicateMinutes` |

The first scheduled report is the compliance representative; additional messages remain in the report table. A stated slot controls matching, while the send time controls punctuality. Times are modeled as export-local wall-clock values using UTC arithmetic to avoid browser timezone drift. For real deployment, ingest timestamps as UTC and configure the service timezone explicitly.

Escalation response matching requires a later nurse-supervisor message with client, caregiver or vital-value context within `responseSearchMinutes`. This is explainable, but production should use message IDs or explicit case references. Responses without a caregiver tag are still linked as evidence, while the status remains `NOT_TAGGED`.

Run `npm test` after changing any rule. The complete-file regression test catches altered totals and key clinical cases. `/analysis` is generated from the supplied sample at build time; imported files change the interactive dashboard only.
