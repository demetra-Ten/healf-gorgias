"""Point every product link at the Shopify VARIANT page, not the product page.

    .../products/9074211455215            ->  .../products/9074211455215/variants/46895830991087

Agents land on the variant, which is where stock and the pre-order date actually live.
Products no longer in the published catalogue keep their product-page link.
"""
import json, os, re, sys, urllib.request

SB = os.environ["SUPABASE_SECRET_KEY"]   # never hard-code the key
U  = "https://imtapqvlfjcnyrsmpatg.supabase.co/rest/v1/tickets"
H  = {"apikey": SB, "Authorization": "Bearer " + SB, "Content-Type": "application/json"}
APPLY = "--apply" in sys.argv

idx = json.load(open('product_index.json'))
rows = json.load(open('all_tickets_items.json'))
LINK = re.compile(r'(https://admin\.shopify\.com/store/how2go/products/(\d+))(?!/variants/)')

changed, skipped, tickets = 0, 0, 0
plan = []
for t in rows:
    src = t['order_items'] or ''
    if not src: continue
    n_local = [0, 0]
    def sub(m):
        pid = m.group(2)
        p = idx.get(pid)
        if p and p.get('variant_id'):
            n_local[0] += 1
            return "%s/variants/%s" % (m.group(1), p['variant_id'])
        n_local[1] += 1
        return m.group(1)
    out = LINK.sub(sub, src)
    if out != src:
        tickets += 1
        plan.append({'id': t['id'], 'order_items': out})
    changed += n_local[0]; skipped += n_local[1]

print("links updated to variant pages: %d" % changed)
print("left as product pages (not in catalogue): %d" % skipped)
print("tickets affected: %d" % tickets)

if not APPLY:
    print("\nDRY RUN - rerun with --apply"); sys.exit()

for p in plan:
    req = urllib.request.Request(U + "?id=eq.%d" % p['id'],
        data=json.dumps({'order_items': p['order_items']}).encode(),
        headers=dict(H, Prefer="return=minimal"), method="PATCH")
    urllib.request.urlopen(req)
print("\nwritten to %d tickets" % len(plan))
