"""Load the Shopify sim: the frozen catalogue and each ticket's stock-on-the-day.

    SUPABASE_SECRET_KEY=... python3 load-shop-catalogue.py [--pull] [--dry]

--pull  re-fetches healf.com/products.json first (about a minute) into catalogue.json.
        Without it the existing catalogue.json is reused, so a re-run is a no-op for
        the catalogue. Only pull when Demetra asks for a refresh (per cohort).
--dry   builds and counts everything but writes nothing.

Reads ticket-stock.json (git-ignored: its notes quote the hidden ideal answers) for the
per-ticket state, and the live tickets table for order lines. Writes:
  shop_products         catalogue (active) + products that have left the store but are
                        on a ticket (archived) + seed-only products for order lines with
                        no real product (negative ids)
  shop_ticket_products  one row per ticket x product the ticket is about
"""
import json, os, re, sys, time, zlib, urllib.request, urllib.error, html as htmllib

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'https://imtapqvlfjcnyrsmpatg.supabase.co/rest/v1/'
KEY = os.environ.get('SUPABASE_SECRET_KEY') or sys.exit('set SUPABASE_SECRET_KEY')
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
DRY = '--dry' in sys.argv
CAT = os.path.join(HERE, 'catalogue.json')

def rest(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(URL + path, method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit('%s %s -> %s %s' % (method, path, e.code, e.read().decode()[:600]))

def pull():
    out, page = [], 1
    while page <= 120:
        u = 'https://how2go.myshopify.com/products.json?limit=250&page=%d' % page
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60))
        except Exception as e:
            if '429' in str(e): time.sleep(15); continue
            raise
        ps = d.get('products', [])
        if not ps: break
        for p in ps:
            tags = [t.strip() for t in p.get('tags', [])]
            desc = re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', ' ', p.get('body_html') or ''))).strip()[:600]
            out.append({'id': p['id'], 'title': p['title'].strip(), 'handle': p.get('handle'),
                'vendor': (p.get('vendor') or '').strip(), 'product_type': (p.get('product_type') or '').strip(),
                'tags': tags, 'description': desc,
                'image_url': (p.get('images') or [{}])[0].get('src') if p.get('images') else None,
                'published_at': p.get('published_at'),
                'preorder': any(t.lower() == 'preorderproduct' for t in tags),
                'variants': [{'id': v['id'], 'title': v.get('title'), 'sku': v.get('sku'), 'price': float(v.get('price') or 0),
                              'compare_at': float(v['compare_at_price']) if v.get('compare_at_price') else None,
                              'available': bool(v.get('available'))} for v in p.get('variants') or []]})
        print('page', page, len(out), flush=True); page += 1; time.sleep(1.5)
    json.dump(out, open(CAT, 'w'))

def line_parts(l):
    vendor = (re.search(r'@@\s*(.+?)\s*$', l) or [None, ''])[1]
    l = re.sub(r'\s*@@.*$', '', l)
    m = re.match(r'^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$', l)
    title, url, rest_ = (m.group(1), m.group(2), m.group(3)) if m else (re.split(r'\s\(x?\d+\)', l)[0], '', l)
    pid = re.search(r'/products/(\d+)', url); vid = re.search(r'/variants/(\d+)', url)
    price = re.search(r'£\s?([\d.,]+)', rest_)
    return {'title': title.strip(), 'pid': int(pid.group(1)) if pid else None, 'vid': int(vid.group(1)) if vid else None,
            'vendor': vendor, 'price': float(price.group(1).replace(',', '')) if price else 0.0}

def seed_id(ticket_id, title):
    return -(zlib.crc32(('%s|%s' % (ticket_id, title.lower())).encode()) % 10**12 + 1)

if '--pull' in sys.argv or not os.path.exists(CAT): pull()
catalogue = json.load(open(CAT))
cat_ids = {p['id'] for p in catalogue}
stock = json.load(open(os.path.join(HERE, 'ticket-stock.json')))
tickets = rest('GET', 'tickets?select=id,order_items&category_id=not.is.null')

products = {p['id']: dict(p, status='active') for p in catalogue}
lines_by_ticket = {}
for t in tickets:
    for raw in (t.get('order_items') or '').split('\n'):
        if not raw.strip() or raw.startswith('@@ORDER'): continue
        lp = line_parts(raw); lines_by_ticket.setdefault(t['id'], []).append(lp)
        if lp['pid'] and lp['pid'] not in products:      # left the store since the order
            products[lp['pid']] = {'id': lp['pid'], 'title': re.sub(r' - [^-]+$', '', lp['title']) if lp['vid'] else lp['title'],
                'vendor': lp['vendor'], 'product_type': '', 'tags': [], 'description': '', 'image_url': None,
                'status': 'archived', 'preorder': False, 'published_at': None,
                'variants': [{'id': lp['vid'] or lp['pid'], 'title': lp['title'].split(' - ')[-1] if lp['vid'] else 'Default Title',
                              'sku': None, 'price': lp['price'], 'compare_at': None, 'available': False}]}

state = {}   # (ticket, product) -> row; a non-in-stock state wins over a duplicate in_stock
def put(tid, pid, availability, eta=None, price=None, note=None, line_title=None):
    k = (tid, pid); old = state.get(k)
    if old and old['availability'] != 'in_stock' and availability == 'in_stock': return
    state[k] = {'ticket_id': tid, 'product_id': pid, 'availability': availability, 'eta': eta,
                'price': price, 'note': note, 'line_title': line_title}

for r in stock['rows']:
    tid, pid = r['ticket_id'], r['product_id']
    line = next((l for l in lines_by_ticket.get(tid, []) if l['title'] == r['line_title']), None)
    linked = bool(line and line['pid'])
    if pid is None:                                       # no real product: a seed-only one
        pid = seed_id(tid, r['line_title'])
        products[pid] = {'id': pid, 'title': r['line_title'], 'vendor': (line or {}).get('vendor') or '', 'product_type': '',
            'tags': [], 'description': '', 'image_url': None, 'status': 'active', 'preorder': r['availability'] == 'preorder',
            'published_at': None, 'variants': [{'id': pid, 'title': 'Default Title', 'sku': None,
            'price': (line or {}).get('price') or 0.0, 'compare_at': None, 'available': r['availability'] == 'in_stock'}]}
    put(tid, pid, r['availability'], r.get('eta'), r.get('price'), r.get('note'), None if linked else r['line_title'])
for a in stock.get('alternatives', []):
    if a.get('product_id') in products: put(a['ticket_id'], a['product_id'], 'in_stock', note='alternative the ideal handling offers')
for u in stock.get('unlisted_products', []):
    if u.get('product_id') in products: put(u['ticket_id'], u['product_id'], u['availability'], u.get('eta'), None, u.get('note'))

COLS = ['id', 'title', 'handle', 'vendor', 'product_type', 'tags', 'description', 'image_url', 'status', 'preorder', 'variants', 'published_at']
prows = [{c: (p.get('tags') or []) if c == 'tags' else p.get(c) for c in COLS} for p in products.values()]
srows = list(state.values())
print('products', len(prows), '(archived %d, seed-only %d)' % (sum(p['status'] == 'archived' for p in prows), sum(p['id'] < 0 for p in prows)),
      '| ticket stock rows', len(srows))
if DRY: sys.exit()
for i in range(0, len(prows), 500):
    rest('POST', 'shop_products?on_conflict=id', prows[i:i + 500], 'resolution=merge-duplicates,return=minimal')
    print('products', i + 500, flush=True)
rest('DELETE', 'shop_ticket_products?ticket_id=gte.0', prefer='return=minimal')
for i in range(0, len(srows), 500):
    rest('POST', 'shop_ticket_products', srows[i:i + 500], 'return=minimal')
print('done')
