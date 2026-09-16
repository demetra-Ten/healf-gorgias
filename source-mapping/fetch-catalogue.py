import json, os, time, urllib.request
idx = {}
page = 1
while page <= 80:
    url = "https://how2go.myshopify.com/products.json?limit=250&page=%d" % page
    try:
        d = json.load(urllib.request.urlopen(
            urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=45))
    except Exception as e:
        if '429' in str(e):
            time.sleep(10); continue
        print("stopped at page", page, e, flush=True); break
    ps = d.get('products', [])
    if not ps:
        break
    for p in ps:
        vs = p.get('variants') or []
        v = vs[0] if vs else {}
        tags = [t.strip().lower() for t in p.get('tags', [])]
        idx[str(p['id'])] = {
            'id': str(p['id']), 'title': p['title'].strip(), 'handle': p.get('handle', ''),
            'vendor': (p.get('vendor') or '').strip(),
            'price': float(v.get('price') or 0),
            'variant_id': str(v.get('id') or ''),
            'variants': [{'id': str(x.get('id')), 'title': x.get('title'),
                          'price': float(x.get('price') or 0)} for x in vs],
            'available': bool(v.get('available')),
            'preorder': 'preorderproduct' in tags,
        }
    print("page %d -> %d products" % (page, len(idx)), flush=True)
    page += 1
    time.sleep(2.0)
json.dump(idx, open('product_index.json', 'w'))
print("DONE", len(idx), flush=True)
