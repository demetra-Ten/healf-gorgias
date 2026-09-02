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


## Order history must be AS AT the message date (fixed 2026-09-01)

**The bug Demetra caught on ticket 145 (Nora Beck):** the original enrichment took the
customer's ~5 MOST RECENT Shopify orders as of the day it ran — not as of the ticket date.
So a customer who wrote on 11 May was shown orders from June and July, i.e. orders that had
not happened yet when they got in touch. Her words: *"orders have been placed after the 11th
of may (in July) making the dates all off here."*

**Rule: a sim ticket must show the real customer's order history exactly as it stood on the
day they wrote — no order dated after `⟦SENT|…⟧`.**

`rebuild-order-history.py <sim_ticket_id> <saved_get_ticket_file> [apply]` does this:
pulls `customer.integrations[*].orders` (real Shopify) out of a saved `get_ticket`
(`with_customer=true`) response, keeps only orders created on/before the ticket's sent date,
takes the 5 most recent of those, and rewrites `order_items` plus the
`order_number`/`order_value`/`order_status` columns. Run without `apply` for a dry run.

Line format is rebuilt from the real fields: `title - variant_title`, real `product_id` for
the admin URL, real quantity, price, per-line `fulfillment_status` and vendor. Only product
and order data is copied — never the shipping/billing address or contact details.

**Fixed:** 145 Nora Beck, 160 Tess Harlow, 165 Raj Sethi, 143 Elsa Lind, 146 Ivo Kral.
Those were the only 5 of 105 dated tickets with a future-dated order. Re-scan after any
enrichment work: for every ticket, assert no `@@ORDER` date is later than its `⟦SENT|…⟧`.
