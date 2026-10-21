import json,sys,re,datetime,urllib.request
import os
SB=os.environ.get("SUPABASE_URL","https://imtapqvlfjcnyrsmpatg.supabase.co")
# Never hardcode the key. Export it before running:  export SUPABASE_SECRET_KEY=...
K=os.environ["SUPABASE_SECRET_KEY"]
def hdr(): return {'apikey':K,'Authorization':'Bearer '+K}

# Real Healf order numbers never go into the sim (2026-10-21). Every real number pulled from
# Gorgias is swapped for its fake one from order-number-map.json (git-ignored); an unseen one
# gets the next free fake in #H-91xxxxx-#H-95xxxxx and the map is saved.
MAP_FILE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'order-number-map.json')
NUMS=json.load(open(MAP_FILE)) if os.path.exists(MAP_FILE) else {}
def fake_number(real):
    real='#H-'+re.sub(r'\D','',str(real or ''))
    if real in NUMS: return NUMS[real]
    nxt=max([int(v[3:]) for v in NUMS.values()] + [9104000]) + 1 + len(NUMS) % 997
    assert nxt < 9600000, 'fake ticket-order range used up'
    NUMS[real]='#H-%d' % nxt
    json.dump(NUMS, open(MAP_FILE,'w'), indent=0)
    return NUMS[real]
def sim(tid):
    r=urllib.request.Request(SB+"/rest/v1/tickets?select=*&id=eq.%d"%tid, headers=hdr())
    return json.load(urllib.request.urlopen(r))[0]
def real_orders(f):
    d=json.load(open(f)); t=json.loads(d['result']) if isinstance(d.get('result'),str) else d
    ints=(t.get('customer') or {}).get('integrations') or {}
    out=[]
    for v in ints.values():
        if isinstance(v,dict) and v.get('__integration_type__')=='shopify':
            out += (v.get('orders') or [])
    return t, out
def build(orders, cutoff, keep=5):
    ok=[]
    for o in orders:
        ca=(o.get('created_at') or '')[:10]
        if not ca: continue
        dt=datetime.date.fromisoformat(ca)
        if dt <= cutoff: ok.append((dt,o))
    ok.sort(key=lambda x:-x[0].toordinal())
    ok=ok[:keep]
    blocks=[]
    for dt,o in ok:
        st=(o.get('fulfillment_status') or 'unfulfilled')
        blocks.append("@@ORDER|%s|£%s|%s|%s" % (fake_number(o.get('name')), o.get('total_price'), st, dt.strftime('%d/%m/%Y')))
        for l in (o.get('line_items') or []):
            title=l.get('title') or ''
            vt=l.get('variant_title')
            if vt and vt.lower() not in ('default title',): title = "%s - %s" % (title, vt)
            lst=l.get('fulfillment_status')
            tag=(" [%s]" % lst) if lst else ""
            blocks.append("[%s](https://admin.shopify.com/store/how2go/products/%s) (x%s) — £%s%s @@%s" % (
                title, l.get('product_id'), l.get('quantity'), l.get('price'), tag, l.get('vendor') or 'Healf'))
    top = ok[0][1] if ok else None
    return "\n".join(blocks), top, len(ok)

tid=int(sys.argv[1]); f=sys.argv[2]; apply = len(sys.argv)>3 and sys.argv[3]=='apply'
s=sim(tid)
m=re.match(r'^⟦SENT\|([^⟧]+)⟧', s['message'] or '')
cutoff=datetime.datetime.fromisoformat(m.group(1).replace('Z','+00:00')).date()
t,orders=real_orders(f)
items,top,n=build(orders,cutoff)
print("sim %s (%s) | source %s | message %s" % (tid, s['customer_name'], t.get('id'), cutoff))
print("real orders total %d -> kept %d dated on/before the message" % (len(orders),n))
for l in items.splitlines():
    if l.startswith('@@ORDER'): print("   ", l)
if apply:
    body={'order_items':items}
    if top:
        body['order_number']=fake_number(top.get('name'))
        body['order_value']='£%s' % top.get('total_price')
        body['order_status']=top.get('fulfillment_status') or 'unfulfilled'
    req=urllib.request.Request(SB+"/rest/v1/tickets?id=eq.%d"%tid, data=json.dumps(body).encode(),
        method='PATCH', headers={**hdr(),'Content-Type':'application/json','Prefer':'return=minimal'})
    print("APPLIED HTTP", urllib.request.urlopen(req).status)
else:
    print("(dry run)")
