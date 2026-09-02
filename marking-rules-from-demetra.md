# Marking rule changes — from Demetra's feedback on Panchita's tickets (2026-09-01)

Source: 8 trainer verdicts on submissions 13, 38, 69, 71, 73, 80, 81, 82.
Target: n8n workflow **DHLJ1PVNIj9kEnsl** ("Healf Training - Reply Scoring"),
nodes **Score Reply** (system prompt) and **Resolve SOP** (category SOP text).

---

## A. Feedback structure — split optional from required

Demetra (sub 81): *"Maybe optional/improvements that do not hinder their mark could come
under 'Suggested improvements' and then things that urgently need improving as
'Necessary improvements'."* She likes the optional-suggestion feature (sub 80: *"I do like
that this 'optional improvement' feature is in there"*) — the problem is it currently costs marks.

Replace the current two-part bullet format with **three** headed sections in both
`response_feedback` and `actions_feedback`:

```
What you did well:
- ...

Necessary improvements:
- ...            <- genuine faults. THESE are what drive the score.

Suggested improvements:
- ...            <- optional polish. MUST NOT affect the score.
```
If there is nothing necessary, write `- Nothing — this was correct.` under Necessary
improvements. Only faults listed under **Necessary improvements** may reduce the score.

## B. Stop scoring the sign-off

Sub 71: *"remove 'The 'With Healf,' close is correctly used.' from all marking criteria."*
Delete every reference to the `With Healf,` close from the system prompt and from the
per-category SOPs (it currently appears in the Good-reply signals of most categories).
Do not praise it, do not fault it, do not mention it.

## C. Internal notes are massively over-required

"No internal note needed here" appears in **five** of eight reviews (13, 69, 73, 80, 81).
Current wording invites the marker to invent a requirement.

New rule: **default is that NO internal note is needed.** Only expect one when the
handling itself hands work to someone else, i.e. exactly:
- a Manual Order / replacement was raised (note must carry the MO number),
- the ticket was escalated (note who and why),
- possible **fraud** is being flagged for the next agent (sub 81: *"It would be good to have
  an internal note flagging possible fraud and to see if customer requests refund"*),
- a GXO / warehouse error or #customer-feedback entry was logged,
- a follow-up or monitoring instruction is needed for the next agent (sub 38: an internal
  note about the query helps the next agent handle follow-ups).

Outside those cases **never mention the internal note at all** — not as a fault, not as a
suggestion. A missing note is never a RESPONSE fault.

## D. Macros — say less

Sub 81: *"when correct macro has been used, just say: correct macro used"*.
Do not elaborate, do not re-justify, do not suggest a marginally better macro.

**Never contradict yourself** (sub 82: *"marking contradicts itself as it says correct macro
use but then says incorrect macro use"*). Decide once per reply whether the macro was right
and keep that verdict consistent across both axes.

## E. Things to stop commenting on

- **Address details** (sub 81): auto-filled by Gorgias. Only comment if the trainee did
  NOT fill them in. Never praise or flag a correctly filled address.
- **Recharge cancellation reason** (sub 69): *"no need to mark the cancellation reason
  selected on recharge - ignore this for marking."*
- **Refund reason** (sub 13): not needed while the customer is still choosing between a
  refund and a gift card. Only expect it once they have confirmed which they want.

## F. Factual / SOP corrections

- **Helix no longer exists** (sub 13): *"not search helix as this no longer exists - search
  the website."* Remove every mention of Helix from the SOPs and replace with the Healf
  website. (Currently appears in the Fulfilment SOP twice.)
- **Gift cards round to the nearest £5** (sub 13).
- **Discontinued products** (sub 71): *"we never say we will look into discontinued
  products, we just say it was an issue with the supplier."*
- **Swap vs Recharge** (sub 71): if the order has already been processed/shipped, there is
  **no MO** — the swap is an update to the subscription in Recharge. Only cancel + MO in
  Shopify when the order is unfulfilled and not yet shipped.
- **Skip requests** (sub 73): skipping the imminent order is right, but the reply must also
  confirm when the customer wants the *next* one scheduled.
- **Missing / DNR escalation timing** (sub 81): do NOT escalate straight away. If tracking
  shows it reached the warehouse, offer the replacement first; escalate only if the
  customer pushes for a refund.
- **Pre-order contact reason** (sub 38): `Unfulfilled::Pre-Order` is correct when the
  customer has already placed an order and it is on pre-order. Where stock shows available
  on Shopify but the site still says pre-order, the better handling is to ask the customer
  to place the order and to raise it with Ops in the **#inventory** Slack channel.

## G. Do not over-complicate

Sub 69: *"the marking here really over complicated things … essentially the customer just
wanted to cancel their sub and if possible, their order."*
Mark against what the ticket actually required, not everything that could theoretically be
done. Judge only on information visible on the ticket.

---

## Ticket data fixes from the same feedback

- **Ticket 163 (Clive Denton)** — REVERTED 2026-09-01. A second order was briefly added,
  but the real customer has only ONE Shopify order (`#H-1852082`, 03/02/2026, £31.04,
  fulfilled) and Demetra marked the ticket on exactly that basis — the customer had already
  cancelled the subscription under this account. Ticket now shows that single real order,
  with the real message date (11/05/2026 from source ticket 262633886).
  **Rule: never invent order history. Mark and build against what the real ticket shows.**


---

## H. PENDING — mark only on what the trainee could see (2026-09-02)

Demetra, on ticket 146 (Ivo Kral): *"the real ticket did have a shopify ETA and Nimue could
find it and answer this correctly. In this case though, it is now september … answering a
query talking about stock in june is outdated and will affect trainees reply and training."*

Her actions note read *"check shopify for product preorder day - there is nothing for this
quantity"* — correct behaviour — and the marker faulted her for not confirming the item was
back in stock, a fact that only existed on Shopify in May. Scored 1/3 unfairly.

**Two-part fix. Part one is DONE** (the point-in-time `STOCK_AS_AT` panel in practice.html —
the trainee can now check Shopify inside the sim, as at the ticket date).

**Part two is PENDING — blocked because n8n's `update_workflow` came back from a reconnect
rejecting its `operations` array.** Add this block to the Score Reply system prompt,
immediately after the two-axes paragraph, then `publish_workflow`:

> === MARK ONLY ON WHAT THE TRAINEE COULD SEE — THIS OVERRIDES EVERYTHING BELOW ===
> These are REAL tickets, dated months in the past, practised long after the event. The
> trainee CANNOT look up live Shopify, Recharge or Slack — today's stock levels, ETAs and
> prices no longer match the day the customer wrote. Everything they can legitimately know
> is what the simulator shows: the message thread (including any earlier Lola/agent email),
> the order box, the "Shopify - product status (as at ...)" panel where one is shown, and
> the Recharge panel.
>
> - NEVER fault a trainee for not knowing a stock level, ETA, back-in-stock date, dispatch
>   date, price or availability that is NOT visible in the simulator. If the ideal handling
>   relies on such a fact and the ticket does not show it, treat their handling as correct
>   so long as the approach was sound, and mention it under "Suggested improvements" at most.
> - NEVER tell them they "should have checked the product page / Shopify / Slack" for a live
>   value. Checking is the right instinct and must be credited, not faulted, even when what
>   they found does not match the ideal handling.
> - If a trainee says they could not find an ETA or stock date, that is a legitimate finding,
>   NOT an error. Credit the check and mark the rest of the handling.
> - Do NOT fault any specific date the trainee gives, and do NOT treat a date in the ideal
>   handling as the required answer.
> - Where the thread or the product-status panel DOES state the position, expect them to use
>   it, and it is fair to note if they missed it.

**Still to populate:** 38 tickets depend on a point-in-time stock/ETA fact — cat1 25, cat3 6,
cat5 5, cat2 1, cat6 1. Only 146 has its panel so far. Source the value from the ticket's own
thread or ideal_response where it is stated; the rest need Demetra's input.
