"""Re-point the Fulfilment (pre-order) tickets at products that are GENUINELY on
pre-order in Shopify right now. Run once per cohort.

Trainees are taught to check Shopify, so the products on these tickets must actually
be out of stock with a pre-order date -- otherwise they look the product up, find it
in stock, and the ticket contradicts itself.

    export SUPABASE_SECRET_KEY=...
    python3 refresh-preorder-products.py            # dry run
    python3 refresh-preorder-products.py --apply

Needs, in the working directory:
  preorder_products.json  -- https://how2go.myshopify.com/products.json filtered to
                             products tagged 'preorderproduct' (public, no auth)
  cat1.json               -- tickets where category_id = 1, from the Supabase REST API

Matching is like-for-like (supplement/food/skincare/tech) with a shared-word boost, so
a collagen ticket lands on a collagen product. Where the ticket text names the product,
the text is rewritten to match. Order totals are recalculated from the new prices, and
the trailing @@Vendor token is always re-appended or the brand label disappears.
"""
import json, os, re, sys, difflib, urllib.request

SB = os.environ["SUPABASE_SECRET_KEY"]   # never hard-code the key
U  = "https://imtapqvlfjcnyrsmpatg.supabase.co/rest/v1/tickets"
H  = {"apikey": SB, "Authorization": "Bearer " + SB, "Content-Type": "application/json"}
APPLY = "--apply" in sys.argv

pre = json.load(open('preorder_products.json'))
tix = json.load(open('cat1.json'))
pre_ids = {str(p['id']) for p in pre}

# Match like for like. The tagged pool holds supplements, food, skincare, tech and
# homeware, so a "my supplement hasn't arrived" ticket must not be remapped onto a hat.
BUCKETS = [
 ('supplement', r'capsul|tablet|powder|omega|vitamin|magnesium|collagen|protein|probiotic|'
                r'mushroom|ashwagand|creatine|electrolyte|drops|gummies|sachet|greens|complex|'
                r'extract|supplement|zinc|iron|b12|d3|nmn|coq10|liver oil|bone broth|amino|'
                r'theanine|glycine|melatonin|nac|astaxanthin|tmg|multivit|nutrient'),
 ('food',       r'chips|bars?\b|snack|chocolate|\btea\b|coffee|matcha|honey|butter|granola|cereal|juice|broth'),
 ('skincare',   r'serum|cream|cleanser|moistur|spf|balm|shampoo|conditioner|lotion|toner|'
                r'exfoliat|deodorant|toothpaste|dental|stretch mark|skin'),
 ('tech',       r'\bring\b|wearable|watch|tracker|monitor|lamp|sauna|massag|device|alarm|scale|'
                r'garmin|oura|whoop|apollo|light'),
]
def bucket(title, ptype=''):
    t = (title + ' ' + (ptype or '')).lower()
    for name, pat in BUCKETS:
        if re.search(pat, t): return name
    return 'other'

pool = []
for p in pre:
    v = (p.get('variants') or [{}])[0]
    if not v.get('price'): continue
    pool.append({'id': str(p['id']), 'title': p['title'].strip(),
                 'vendor': (p.get('vendor') or '').strip(),
                 'price': float(v['price']),
                 'bucket': bucket(p['title'], p.get('product_type'))})

LINE = re.compile(r'^\[(.+?)\]\((.*?)\)\s*\(x(\d+)\)\s*—\s*£([\d.]+)\s*(\[[^\]]*\])?\s*(?:@@(.*))?$')
def pick(title, vendor, price, taken):
    """Closest pre-order product of the SAME kind; same vendor is a strong hint."""
    want = bucket(title)
    cands = [c for c in pool if c['bucket'] == want and c['id'] not in taken]
    if not cands:
        cands = [c for c in pool if c['bucket'] == 'supplement' and c['id'] not in taken]
    if not cands:
        cands = [c for c in pool if c['id'] not in taken]
    STOP = {'the','and','with','for','pro','plus','daily','set','pack','single','serve',
            'mg','g','ml','x','of','a','-','–','unflavored','unflavoured','original'}
    def words(t):
        return {w for w in re.findall(r"[a-z0-9']+", t.lower()) if w not in STOP and len(w) > 2}
    wt = words(title)
    def score(c):
        sc = difflib.SequenceMatcher(None, title.lower(), c['title'].lower()).ratio()
        # shared meaningful words matter more than raw string similarity: "Rewind Liquid
        # Collagen" should land on a collagen product, not something merely similar-looking.
        shared = wt & words(c['title'])
        if wt: sc += 0.9 * (len(shared) / len(wt))
        if vendor and c['vendor'].lower() == vendor.lower(): sc += 0.40
        sc -= min(abs(c['price'] - price) / max(price, 1), 1.0) * 0.15
        return sc
    best = max(cands, key=score)
    taken.add(best['id'])
    return best

plan = []
for t in tix:
    lines = (t['order_items'] or '').split('\n')
    out, subs, total, taken = [], [], 0.0, set()
    for ln in lines:
        raw = ln.strip()
        if not raw: continue
        if raw.startswith('@@ORDER|'):
            out.append(raw); continue
        m = LINE.match(raw)
        if not m:
            out.append(raw); continue
        title, url, qty, price, status, vendor = m.group(1), m.group(2), int(m.group(3)), float(m.group(4)), (m.group(5) or ''), (m.group(6) or '').strip()
        pid = (re.search(r'/products/(\d+)', url or '') or [None, None])[1]
        if pid and pid in pre_ids:
            out.append(raw); total += qty * price; continue
        new = pick(title, vendor, price, taken)
        subs.append((title, new['title']))
        out.append('[%s](https://admin.shopify.com/store/how2go/products/%s) (x%d) — £%.2f %s @@%s'
                   % (new['title'], new['id'], qty, new['price'], status or '[unfulfilled]', new['vendor']))
        total += qty * new['price']
    # keep the order header's value in step with the new line items
    for i, ln in enumerate(out):
        if ln.startswith('@@ORDER|'):
            p = ln.split('|')
            while len(p) < 5: p.append('')
            p[2] = '£%.2f' % total
            out[i] = '|'.join(p)
    msg = t['message'] or ''
    for old, new in subs:
        if old and old in msg:
            msg = msg.replace(old, new)
    plan.append({'id': t['id'], 'name': t['customer_name'], 'subs': subs,
                 'order_items': '\n'.join(out), 'message': msg,
                 'msg_changed': msg != (t['message'] or ''), 'total': total})

for p in plan:
    if not p['subs']: continue
    print("t%-4s %-18s %s%s" % (p['id'], p['name'][:18],
          "; ".join("%s -> %s" % (a[:26], b[:34]) for a, b in p['subs']),
          "   [message updated]" if p['msg_changed'] else ""))
print("\n%d tickets remapped, %d line items swapped" % (
      sum(1 for p in plan if p['subs']), sum(len(p['subs']) for p in plan)))

if not APPLY:
    print("\nDRY RUN — rerun with --apply")
    sys.exit()

for p in plan:
    if not p['subs']: continue
    body = {'order_items': p['order_items'], 'order_value': '£%.2f' % p['total']}
    if p['msg_changed']: body['message'] = p['message']
    req = urllib.request.Request(U + "?id=eq.%d" % p['id'], data=json.dumps(body).encode(),
                                 headers=dict(H, Prefer="return=minimal"), method="PATCH")
    urllib.request.urlopen(req)
print("\nwritten")
