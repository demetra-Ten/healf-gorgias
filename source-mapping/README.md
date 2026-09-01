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
