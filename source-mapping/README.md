# Subscription ticket → source Gorgias ticket mapping

Purpose: give sim subscription tickets the REAL customer message date
(`tickets.message_at`) from the Gorgias ticket they were built from, so the
timeline a trainee reasons over matches the real case.

**Source:** "Ticket Training Document" sheet `1e7OSPyfEROS5pQTg3OrSkemazH2rxMAxeVnGM2AO2Jg`
— tabs Grace / Nimue / Nadja; col B = Gorgias ticket link, col C = contact reason.
Filter col C for `Subscription:`.

**Matching method:** the sim reused the REAL Gorgias `subject` (only the customer
name was scrubbed), so subject matches source. Strongest signal is an order number
inside the subject — 140 (#H-2533487), 152 (#H-2553151) and 147 (#H-2470138) match
exactly, which validates the method.

**Fetching:** `get_ticket(id, include_messages=false, with_customer=false)` returns
200KB–1.2MB and auto-saves to a tool-results file — parse it with python rather than
reading it into context. A few ids return `{"success":true}` with no data (merged or
deleted tickets).

**Status:** 13 of 25 cat-5 tickets mapped (see subscription-message-dates.json);
3 of those are parked Healf Zone tickets (147/148/149).

Still unmapped: 142, 145, 146, 150, 151, 153, 154, 155, 156, 159, 160, 162, 163, 164, 165.
Five share the subject "New Contact Form: Subscription" so they need the customer
message text to disambiguate, not just the subject. The rest need the Grace / Nimue tabs.


## Round 2 (2026-09-01) — message-text matching via the warehouse

Better method than the sheet: the Gorgias analytics warehouse holds message bodies, and
sim messages are near-verbatim from source. Pull a distinctive ~10-word phrase from each
sim ticket's CUSTOMER turn, then:

```sql
SELECT ticket_id, ticket_created_at, LEFT(m.body_text,160) AS preview
FROM gaia.tickets CROSS JOIN UNNEST(ticket_messages) AS m
WHERE ticket_created_date >= '2025-11-01' AND m.from_agent = false
  AND (m.body_text LIKE '%<phrase>%' OR ...)
```
~25 phrases per query. Then score sim-vs-preview with difflib locally and keep >= 0.85.
This cross-validated the earlier subject matches exactly (138/139/141/144/152/161).

**Result: 33 tickets now carry real dates** — cat2 7, cat3 9, cat4 2, cat5 15.
`matched-message-dates.json` holds sim id -> gorgias id, date, similarity score.
Two were rejected as too uncertain: sim 74 (0.72) and sim 112 (0.71).

## HARD BOUNDARY: category 1 (Fulfilment) is synthetic

All 30 cat-1 tickets came from `seed-fulfilment.json` in this repo — hand-written
training scenarios, NOT pulled from Gorgias (verified: "Hannah Price" and her exact
message are in the seed file; zero warehouse matches for any cat-1 phrase).
**There are no real dates to recover for cat 1.** Do not keep searching for them.

Remaining without a real date: cat2 27, cat3 21, cat4 22, cat5 10 (plus cat1's 30 that
cannot have one). Likely causes: hand-rewritten during anonymisation, or also seeded.
