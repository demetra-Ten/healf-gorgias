"""Fulfilment tickets where the customer talks about 'one of the items in my order',
or whose order header says Partially fulfilled, but only ONE line item exists — so
there is no 'rest of the order' to send, and 'partially fulfilled' is impossible.

Adds the missing items as GENUINELY IN-STOCK products (not on pre-order), with a
status consistent with the order header, and recalculates the order total.
"""
import json, os, re, sys, random, urllib.request

SB = os.environ["SUPABASE_SECRET_KEY"]   # never hard-code the key
U  = "https://imtapqvlfjcnyrsmpatg.supabase.co/rest/v1/tickets"
H  = {"apikey": SB, "Authorization": "Bearer " + SB, "Content-Type": "application/json"}
APPLY = "--apply" in sys.argv

TARGETS = [1, 3, 6, 27, 29, 30, 33]
instock = json.load(open('instock_products.json'))
tix = {t['id']: t for t in json.load(open('cat1_now.json'))}

SUPP = re.compile(r'capsul|tablet|tabs|powder|omega|vitamin|magnesium|collagen|protein|'
                  r'probiotic|mushroom|ashwagand|creatine|electrolyte|drops|gummies|greens|'
                  r'complex|zinc|iron|b12|d3|nmn|coq10|broth|amino|theanine|glycine|betaine', re.I)
LINE = re.compile(r'^\[(.+?)\]\((.*?)\)\s*\(x(\d+)\)\s*—\s*£([\d.]+)\s*(\[[^\]]*\])?\s*(?:@@(.*))?$')

def stem(t):
    """First couple of meaningful words — used to spot sibling variants of the same product."""
    ws = [w for w in re.findall(r"[a-z0-9']+", t.lower()) if len(w) > 2]
    return " ".join(ws[:2])

def companions(seed_title, seed_vendor, seed_price, n):
    """Plausible basket-mates. Nobody buys three colourways of the same blanket or two
    Oura rings, so sibling variants are excluded, and a mate must not cost more than the
    pre-order item -- otherwise the 'rest of the order' dwarfs what they wrote in about."""
    rnd = random.Random(hash(seed_title) & 0xffff)
    seed_stem = stem(seed_title)
    cap = max(seed_price * 1.1, 12.0)
    seed_base = seed_title.split(' - ')[0].strip().lower()   # "Body - Midnight" -> "body"
    def usable(p):
        return (p['title'].split(' - ')[0].strip().lower() != seed_base
                and stem(p['title']) != seed_stem
                and p['title'].lower() != seed_title.lower()
                and p['price'] <= cap)
    same = [p for p in instock if p['vendor'].lower() == seed_vendor.lower() and usable(p)]
    pool = same if len(same) >= n else [
        p for p in instock if SUPP.search(p['title']) and usable(p)
        and 0.25 * seed_price <= p['price'] <= cap]
    rnd.shuffle(pool)
    return pool[:n]

plan = []
for tid in TARGETS:
    t = tix[tid]
    lines = [l.strip() for l in (t['order_items'] or '').split('\n') if l.strip()]
    hdr = lines[0] if lines[0].startswith('@@ORDER|') else None
    body = [l for l in lines if not l.startswith('@@ORDER|')]
    m = LINE.match(body[0])
    title, qty, price, vendor = m.group(1), int(m.group(3)), float(m.group(4)), (m.group(6) or '').strip()

    # most of these carry the status in the order_status column, not an @@ORDER header
    hdr_status = (hdr.split('|')[3] if hdr and len(hdr.split('|')) > 3 else '') or (t['order_status'] or '')
    partial = 'partial' in hdr_status.lower()
    # Partially fulfilled means the rest genuinely shipped; an unfulfilled pre-order
    # order means the whole basket is being held.
    mate_status = '[fulfilled]' if partial else '[unfulfilled]'
    n = 2 if partial else 1

    mates = companions(title, vendor, price, n)
    new_lines = list(body)
    total = qty * price
    for mp in mates:
        new_lines.append('[%s](https://admin.shopify.com/store/how2go/products/%s) (x1) — £%.2f %s @@%s'
                         % (mp['title'], mp['id'], mp['price'], mate_status, mp['vendor']))
        total += mp['price']
    if hdr:
        p = hdr.split('|')
        while len(p) < 5: p.append('')
        p[2] = '£%.2f' % total
        new_lines.insert(0, '|'.join(p))
    plan.append({'id': tid, 'name': t['customer_name'], 'status': hdr_status,
                 'added': [(mp['title'], mp['price'], mate_status) for mp in mates],
                 'order_items': '\n'.join(new_lines), 'total': total})

for p in plan:
    print("t%-4s %-15s %-22s total £%-8.2f" % (p['id'], p['name'][:15], p['status'][:22], p['total']))
    for ti, pr, st in p['added']:
        print("        + %-52s £%-7.2f %s" % (ti[:52], pr, st))

if not APPLY:
    print("\nDRY RUN — rerun with --apply"); sys.exit()

for p in plan:
    body = {'order_items': p['order_items'], 'order_value': '£%.2f' % p['total']}
    req = urllib.request.Request(U + "?id=eq.%d" % p['id'], data=json.dumps(body).encode(),
                                 headers=dict(H, Prefer="return=minimal"), method="PATCH")
    urllib.request.urlopen(req)
print("\nwritten")
