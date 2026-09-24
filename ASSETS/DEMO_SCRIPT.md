# Five-minute demonstration

**0:00–0:30 — Problem.** Open the operations view. Explain that raw caregiver WhatsApp messages bury missing slots and abnormal readings. The application generates expected slots independently of arrived messages.

**0:30–1:00 — Intake.** Point to the local-processing notice. Drop `ASSETS/Sample_Homecare_WhatsApp_Export.txt` or use **Load sample**. Explain that a new `.txt` export follows the same parser, and no patient file is uploaded.

**1:00–1:45 — Two-minute view.** Show the five defined KPIs and priority queue. State active expected, unique received, missing and late totals. Open an info tooltip to show the denominator.

**1:45–2:30 — Clinical exception.** Open the HC-01 BP 182/112 item. Show original line, missing caregiver tag, matched supervisor message and 192-minute response. Contrast the HC-04 SpO₂ 88% response within 8 minutes on the Escalations tab.

**2:30–3:20 — Compliance pattern.** In the shift pulse, select HC-04 dates to show repeated 15:00 gaps and HC-02 dates for overnight gaps. Open a missing slot and show the schedule rule and expected caregiver. Mention HC-05 pause removes five slots.

**3:20–4:10 — Data trust.** Show `1300/86`, `99.1F`, duplicate preservation, incomplete reports and repeated identical HC-03 day vitals. Inspect one raw message; distinguish clinical alerts from data validation.

**4:10–4:50 — New file and deliverables.** Open Vitals Log filters and CSV export. Point to `/analysis` and `/team-plan` print views. Explain the live webhook/queue path in one sentence and how rules can be changed in `src/config/rules.ts`.
