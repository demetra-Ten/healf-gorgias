// Ticket data helpers shared by the Gorgias sim (practice.html) and the Shopify sim
// (shopify.html). Both must show a ticket's orders, address and tracking identically,
// so they read them from this one file rather than keeping two copies in step.

// Real customer-message sent time, taken from the source Gorgias ticket's created_datetime.
// Stored as a leading sentinel on `message` (no DB column needed) e.g. ⟦SENT|2026-07-10T08:48:27Z⟧
const SENT_SENTINEL = /^\s*⟦SENT\|([^⟧]+)⟧\s*/;

function sentAt(ticket) {
  const m = SENT_SENTINEL.exec(String((ticket && ticket.message) || ''));
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d) ? null : d;
}

function stripSent(text) { return String(text || '').replace(SENT_SENTINEL, ''); }

const PRODUCTS_BY_ID = {
  1: "Grass Fed Whey Protein Isolate – Unflavoured (x1) — £39.99 [pre-order]\nMagnesium Glycinate (x1) — shipped",
  2: "NMN 500mg (x1) — £15.98 [pre-order]\nFree sample: Collagen sachet (x1) — £0.00",
  3: "Buffered Ascorbic Acid (Vitamin C) Powder (x1) — £15.99 [pre-order]\nBuffered Ascorbic Acid – 90 caps (x1) — £15.99 [in stock]",
  4: "Theragun Pro Massage Device (x1) — £449.10 [pre-order]",
  5: "Optimal PC Softgels (x1) — £46.00 [pre-order, ETA 11 May]",
  6: "Sun Balm SPF 50+ PA++++ (x1) — £21.57 [pre-order, ETA 17 May]\n(rest of order already shipped)",
  7: "Active Collagen (x1) — £55.98 [pre-order, ordered February]",
  8: "Raspberry Leaf Tea (x1) — £24.98 [pre-order]\nLemongrass, Raspberry & Hibiscus Infusion (x1) — free",
  17: "Magnesium Glycinate (x1) — £29.99 [out of stock / delayed]",
  18: "Vitamin D3 + K2 (x1) — £19.99 [pre-order]",
  19: "Marine Collagen Powder (x1) — £42.00 [discontinued]",
  21: "Lion's Mane Extract (x2) — £64.00 [pre-order, delayed twice]",
  22: "Ashwagandha KSM-66 (x1) — £38.00 [unfulfilled]",
  23: "Thorne Basic Nutrients Multivitamin (x1) — £48.00\nBare Biology Omega-3 (x1) — £40.00\nFree gift (not received): Healf tote bag",
  24: "Ashwagandha (x1) — £18.00 [missing / pending]\nMagnesium (x1) — £18.00 [delivered]\nVitamin C (x1) — £18.00 [delivered]",
  25: "Ceremonial Grade Matcha (x1) — £27.00 [pre-order]",
  26: "Reishi Mushroom Blend (x1) — £45.00 [cancelled]",
  27: "Berberine (x1) — £29.99 [pre-order]\nCreatine Monohydrate (x1) — £20.00 [shipping]\nElectrolytes (x1) — £21.01 [shipping]",
  28: "Bare Biology Omega-3 (x1) — £33.00 [pre-order, ETA after next week]",
  29: "Bone Broth – Fish (x1) — £36.00 [pre-order]\n(other items in order in stock)",
  30: "Balance Breathing Device (x1) — £89.00 [pre-order]\nMagnesium Glycinate (x1) — £31.00 [ships in 2-3 days]",
  31: "Nootropic Focus Blend (x1) — £28.00 [listed for pre-order on site]",
  32: "Creatine Monohydrate (x1) — £40.00 [OOS but showing Fulfilment in Progress]",
  33: "Hears One – Jet Black (x1) — £29.99 [pre-order, ETA 4 July]\n(rest of order shipped)",
  34: "Clevr Blends SuperLatte – Matcha (x1) — £32.00 [pre-order, keeps slipping]",
  35: "Momentous Grass Fed Whey Isolate – Unflavoured (x1) — £45.00 [pre-order]",
  36: "Probiotic Complex (x1) — £39.00 [discontinued, ordered December]",
  37: "Oura Ring 4 – Silver (x1) — £349.00 [pre-order]\nFree gifts (x2) — £0.00",
  38: "NAC (N-AcetylCysteine) 600mg (x1) — £29.00 [unfulfilled]\nMega EPA Forte (x1) — £29.00 [Fulfilment in Progress]"
};

function ticketProducts(t) { return (t && (t.order_items || PRODUCTS_BY_ID[t.id])) || ''; }

function spCustomerTags(ticket, orders) {
  const t = [];
  if (ticket.loyalty_tier) t.push(ticket.loyalty_tier);
  if (Number(ticket.category_id) === 5) t.push('Active Subscriber');
  if (orders.length > 1) t.push('Repeat customer');
  t.push('UK');
  return t;
}

function spOrderTags(ticket, o) {
  const t = ['UK'];
  if (Number(ticket.category_id) === 5) t.push('Subscription');
  return t;
}

// Normalise any raw order status to one of the three real Shopify fulfilment states.
function fulfilment(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('cancel')) return { label: 'Cancelled', cls: 'os-cancelled' };
  if (s.includes('partial')) return { label: 'Partially fulfilled', cls: 'os-partial' };
  if (s.includes('deliver') || s.includes('shipped') || s === 'fulfilled') return { label: 'Fulfilled', cls: 'os-fulfilled' };
  return { label: 'Unfulfilled', cls: 'os-unfulfilled' };
}

// A ticket's order_items may hold ONE order (legacy: line items only, header from the
// order_number/value/status columns) OR MULTIPLE orders, each prefixed by a header line
// "@@ORDER|<number>|<value>|<status>|<date>". Returns an array of order objects.
function parseOrders(ticket) {
  const raw = (ticket.order_items || '').trim();
  if (raw.indexOf('@@ORDER|') !== -1) {
    return raw.split('@@ORDER|').map(s => s.trim()).filter(Boolean).map(block => {
      const nl = block.indexOf('\n');
      const header = (nl === -1 ? block : block.slice(0, nl)).trim();
      const items = nl === -1 ? '' : block.slice(nl + 1).trim();
      const p = header.split('|').map(x => (x || '').trim());
      return { number: p[0] || '', value: p[1] || '', status: p[2] || '', date: p[3] || '', items };
    }).map((o, i) => {
      // Some orders were stored with a blank header; the ticket's own columns hold the real
      // number and value. (Status is left as stored: it drives the badge trainees see.)
      if (!o.number && i === 0 && ticket.order_number) { o.number = ticket.order_number; o.value = o.value || ticket.order_value || ''; }
      // Real orders always have a number and the Shopify sim finds orders by it.
      if (!o.number) o.number = '#H-' + (9600000 + ((Number(ticket.id) || 0) * 97 + i * 7919) % 99991);   // fake range, see shopify.html
      return o;
    });
  }
  if (ticket.order_number) return [{ number: ticket.order_number, value: ticket.order_value || '', status: ticket.order_status || '', date: ticket.order_date || '', items: raw }];
  return [];
}

const RECHARGE_CANCELLED = { 163: true };

// ── Royal Mail tracking (category 6 = UK Delivery) — SIMULATED, matched to each ticket's scenario ──
const UK_TRACKING = {
  166:'delivered_notreceived', 167:'delivered_notreceived', 168:'delivered_notreceived', 169:'delivered_ok',
  170:'delivered_notreceived', 171:'lost_nomovement', 172:'delivered_wrongplace', 173:'lost_nomovement',
  174:'delivered_wrongplace', 175:'delivered_notreceived', 176:'rts', 177:'delivered_notreceived',
  178:'delivered_notreceived', 179:'delivered_wrongplace', 180:'late_intransit', 181:'late_intransit',
  182:'late_labelcreated', 183:'late_intransit', 184:'lost_nomovement', 185:'rts', 186:'rts', 187:'rts',
  188:'rts', 189:'rts', 190:'lost_nomovement', 191:'lost_nomovement', 192:'delivered_ok', 193:'delivered_ok',
  194:'delivered_ok', 195:'delivered_wrongplace'
};

const TRACK_CACHE = {};

function rmNumber(t) {
  const base = String(t.order_number || ('H' + t.id)).replace(/\D/g, '') || String(1000000 + t.id);
  const digits = (base + '000000000').slice(0, 9);
  const A = 'ABDEHJKR';
  return A[t.id % A.length] + A[(t.id * 7) % A.length] + digits + 'GB';
}

function rmDate(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  const ds = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hh = String(8 + (daysAgo * 3) % 10).padStart(2, '0');
  const mm = String((daysAgo * 17) % 60).padStart(2, '0');
  return ds + ' at ' + hh + ':' + mm;
}

// Per-ticket corrections and details from the ticket's own text (carrier, the tracking
// number an agent quoted, the courier's delivery photo). Filled from an audit of every UK
// Delivery ticket against its message and ideal handling; anything not listed falls back
// to UK_TRACKING and Royal Mail.
const TRACKING_DETAIL = {
  68: {"code": "delivered_notreceived", "carrier": "FedEx", "eventDay": "2026-05-13"},
  166: {"carrier": "Amazon Shipping", "number": "UK4279551257", "eventDay": "2026-07-24", "pod": true, "podCaption": "Parcel photographed at the point of delivery."},
  167: {"code": "delivered_wrongplace", "carrier": "Amazon Shipping"},
  168: {"carrier": "Royal Mail"},
  171: {"code": "delivered_notreceived", "pod": true, "podCaption": "Parcel photographed at the point of delivery."},
  172: {"pod": true, "podCaption": "Parcel left outside a property."},
  173: {"code": "delivered_notreceived"},
  174: {"carrier": "Royal Mail", "eventDay": "2026-05-26"},
  175: {"carrier": "Royal Mail", "eventDay": "2026-05-23", "pod": true, "podCaption": "Parcel left on a doorstep."},
  176: {"code": "delivered_ok"},
  177: {"eventDay": "2026-06-29", "pod": true, "podCaption": "Parcel left inside a building at the point of delivery."},
  178: {"pod": true, "podCaption": "Parcel photographed at the point of delivery."},
  180: {"carrier": "Amazon Shipping", "service": "Amazon Shipping Next Day"},
  181: {"code": "delivered_ok", "service": "Royal Mail Tracked 24™ — Next Working Day"},
  182: {"carrier": "Amazon Shipping", "service": "Amazon Shipping Next Day"},
  183: {"carrier": "Royal Mail", "number": "OX076394529GB", "service": "Royal Mail Tracked 24™ — Next Working Day"},
  184: {"code": "rts", "carrier": "Royal Mail", "number": "OX076286590GB", "eventDay": "2026-05-14"},
  185: {"carrier": "Royal Mail", "number": "FE357224785GB"},
  187: {"carrier": "Royal Mail"},
  188: {"carrier": "Royal Mail", "eventDay": "2026-05-29"},
  189: {"carrier": "Royal Mail"},
  190: {"code": "delivered_wrongplace"},
  191: {"code": "late_intransit"}
};

// An order with no date at all (and a ticket with no message date) still needs one, so the
// order page and its tracking agree: a stable day in summer 2026, never today.
function placeholderOrderDate(t, o) {
  const det = TRACKING_DETAIL[Number(t.id)] || {};
  if (det.eventDay) { const d = new Date(det.eventDay + 'T10:00:00'); d.setDate(d.getDate() - (det.code === 'rts' ? 5 : 3)); return d; }
  const k = (Number(t.id) || 0) * 31 + String((o && o.number) || '').length * 7;
  return new Date(2026, 6, 1 + k % 28, 9 + k % 8, (k * 13) % 60);
}
// The day the order was placed: the parcel's journey runs forward from here.
function orderPlaced(t, o) {
  if (o && o.created) return new Date(o.created);
  const f = shopBaseOrders(t)[0];
  return f && f.created ? new Date(f.created) : placeholderOrderDate(t, o);
}
function fmtTrackDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function amazonNumber(t) { return 'UK' + String(4200000000 + (Number(t.id) * 7919) % 99999999).padStart(10, '0'); }

// The tracking for one order. The ticket's own order (the first one) carries the UK
// Delivery scenario; any other shipped order in the history simply shows as delivered.
function buildTracking(t, o) {
  const first = !o || (parseOrders(t)[0] || {}).number === o.number;
  const det = first ? (TRACKING_DETAIL[t.id] || {}) : {};
  const code = first ? (det.code || UK_TRACKING[t.id] || 'delivered_ok') : 'delivered_ok';
  // Day 0 = the order was placed. A ticket that names the day of delivery / return moves the
  // last scan onto that day (never before the order), and the journey fits in between.
  const placed = orderPlaced(t, o);
  const dayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let span = { delivered_ok: 2, delivered_notreceived: 2, delivered_wrongplace: 2, rts: 5, lost_nomovement: 1, late_intransit: 1, late_labelcreated: 0 }[code];
  if (det.eventDay) { const e = Math.round((dayOf(det.eventDay + 'T12:00:00') - dayOf(placed)) / 86400000); if (e >= 1) span = e; }
  const at = (day, hour, min) => { const d = dayOf(placed); d.setDate(d.getDate() + day); d.setHours(hour, min, 0, 0); return d; };
  // E(daysBefore …) lists scans newest first, counted back from the last one; they are laid
  // onto real days below, clamped so nothing precedes the order.
  const E = (db, hour, min, title, loc) => ({ db, hour, min, title, loc });
  const carrier = det.carrier && det.carrier !== 'unknown' ? det.carrier : 'Royal Mail';
  const amazon = carrier === 'Amazon Shipping', fedex = carrier === 'FedEx';
  const hub = amazon ? 'Amazon Delivery Station' : fedex ? 'FedEx hub, Coventry' : 'Southampton Mail Centre';
  const office = amazon ? 'Out with Amazon Shipping driver' : fedex ? 'On FedEx vehicle for delivery' : 'Local Delivery Office';
  let headline, tone, events, shop;
  switch (code) {
    case 'delivered_wrongplace':
      headline = { s: 'Delivered', sub: 'Item delivered — left in a safe place / with a neighbour' }; tone = 'green'; shop = 'Delivered';
      events = [E(1, 13, 42, 'Delivered', 'Left in a safe place'), E(1, 7, 18, 'Out for delivery', office), E(2, 21, 5, 'Item received', hub), E(4, 16, 30, 'Delivery request received', '')];
      break;
    case 'rts':
      headline = { s: 'Returned to sender', sub: 'We were unable to deliver this item' }; tone = 'amber'; shop = 'Failure';
      events = [E(1, 11, 20, 'Returned to sender', hub), E(2, 15, 4, 'Delivery unsuccessful — item being returned', office), E(3, 7, 12, 'Out for delivery', office), E(4, 22, 40, 'Item received', hub), E(6, 16, 30, 'Delivery request received', '')];
      break;
    case 'lost_nomovement':
      headline = { s: 'In transit', sub: 'We have your item — no tracking updates recently' }; tone = 'grey'; shop = 'In transit';
      events = [E(9, 21, 50, 'Item received', hub + ' — no further tracking updates'), E(11, 16, 30, 'Delivery request received', '')];
      break;
    case 'late_labelcreated':
      headline = { s: 'Awaiting item', sub: 'The sender is despatching your item' }; tone = 'grey'; shop = 'Label printed';
      events = [E(1, 16, 30, 'Delivery request received', '')];
      break;
    case 'late_intransit':
      headline = { s: 'In transit', sub: 'On its way — running slightly behind schedule' }; tone = 'amber'; shop = 'In transit';
      events = [E(0, 6, 55, 'Item received', hub), E(1, 16, 30, 'Delivery request received', '')];
      break;
    case 'delivered_notreceived':
    case 'delivered_ok':
    default:
      headline = { s: 'Delivered', sub: 'We\'ve delivered your item' }; tone = 'green'; shop = 'Delivered';
      events = [E(1, 12, 26, 'Delivered', det.pod ? 'Delivered — photo taken' : 'Delivered'), E(1, 7, 9, 'Out for delivery', office), E(2, 21, 15, 'Item received', hub), E(4, 16, 30, 'Delivery request received', '')];
  }
  const db0 = Math.min.apply(null, events.map(e => e.db));
  events = events.map(e => ({ at: at(Math.max(0, span - (e.db - db0)), e.hour, e.min), title: e.title, loc: e.loc }));
  // Everything is shown as it stood the day the customer wrote, so a parcel that had not
  // arrived by then is still in transit on its tracking.
  const sent = sentAt(t);
  if (sent && events[0].at > sent) {
    events = events.filter(e => e.at <= sent);
    if (events.length) { headline = { s: 'In transit', sub: 'Your item is on its way' }; tone = 'grey'; shop = 'In transit'; }
    else {   // ordered the same day they wrote: only the label exists so far
      events = [{ at: new Date(Math.min(sent.getTime(), placed.getTime())), title: 'Delivery request received', loc: '' }];
      headline = { s: 'Awaiting item', sub: 'The sender is despatching your item' }; tone = 'grey'; shop = 'Label printed';
    }
  }
  const num = det.number || (amazon ? amazonNumber(t) : fedex ? String(770000000000 + (Number(t.id) * 104729) % 99999999999) : rmNumber(t));
  const service = det.service || (amazon ? 'Amazon Shipping' : fedex ? 'FedEx International Priority' : 'Royal Mail Tracked 24™');
  const url = amazon ? 'track.amazon.co.uk/tracking/' + num : fedex ? 'fedex.com/fedextrack/?trknbr=' + num : 'royalmail.com/track-your-item#/tracking-results/' + num;
  return { code, carrier, num, service, url, headline, tone, shop, events,
           delivered: /^Delivered/.test(headline.s) ? events[0].at : null,
           pod: det.pod ? { caption: det.podCaption || 'Photo taken by the driver at delivery.' } : null };
}
function trackingHref(t, o) { return 'tracking.html?t=' + encodeURIComponent(t.id) + (o && o.number ? '&o=' + encodeURIComponent(o.number) : ''); }

// Synthetic (fake) UK shipping address per ticket — stable, deterministic, no real PII.
function custAddress(t) {
  const s = Math.abs(t.id || 1);
  const STREETS = ['Maple Avenue','Bridge Road','Kingfisher Close','Elm Grove','Hanover Street','Priory Lane','Whitfield Road','Cedar Court','Marlow Gardens','Ashcroft Way','Fenwick Street','Latimer Road','Sycamore Drive','Beckett Road','Rosewood Lane'];
  const CITIES = [['London','SW'],['London','SE'],['London','N'],['London','E'],['Manchester','M'],['Bristol','BS'],['Leeds','LS'],['Brighton','BN']];
  const num = (s * 13 % 180) + 1;
  const st = STREETS[s % STREETS.length];
  const flat = (s % 3 === 0) ? ('Flat ' + ((s % 5) + 1) + ', ') : '';
  const c = CITIES[s % CITIES.length];
  const pc = c[1] + ((s % 9) + 1) + ' ' + ((s % 8) + 1) + String.fromCharCode(65 + (s % 6)) + String.fromCharCode(65 + ((s * 3) % 6));
  const street = flat + num + ' ' + st;
  const cityline = c[0] + ', ENG ' + pc;
  const name = t.customer_name || 'the customer';
  return { name, street, cityline, lines: [name, street, cityline, 'United Kingdom'], fillBlock: [street, cityline, 'United Kingdom'].join('\n') };
}

// ── Shopify sim order model ─────────────────────────────────────────────────
// One ticket's orders as the Shopify sim sees them, with everything the trainee has
// done in the Shopify sim (shop_actions) replayed on top. The Gorgias sidebar uses the
// same function, so a cancel made in Shopify shows as cancelled in Gorgias too.
function shopMoney(n) { return '£' + (Number(n) || 0).toFixed(2); }
function shopNum(s) { const m = String(s || '').replace(/,/g, '').match(/-?[\d.]+/); return m ? parseFloat(m[0]) : 0; }
function shopLine(raw) {
  let line = raw.trim(), vendor = '';
  const bm = line.match(/@@\s*(.+?)\s*$/);
  if (bm) { vendor = bm[1].trim(); line = line.replace(/\s*@@.*$/, ''); }
  const m = line.match(/^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/);
  let title = line, url = '', rest = '';
  if (m) { title = m[1]; url = m[2]; rest = m[3]; }
  else { const k = line.search(/\s\(x?\d+\)/); if (k > -1) { title = line.slice(0, k); rest = line.slice(k); } }
  const pid = (url.match(/\/products\/(\d+)/) || [])[1] || null;
  const vid = (url.match(/\/variants\/(\d+)/) || [])[1] || null;
  const qm = rest.match(/\(x?(\d+)\)/i);
  const pm = rest.match(/£\s?([\d.,]+)/);
  const sm = rest.match(/\[([^\]]+)\]/);
  return { title: title.trim(), productId: pid, variantId: vid, qty: qm ? parseInt(qm[1], 10) : 1,
           price: pm ? shopNum(pm[1]) : 0, status: sm ? sm[1].trim().toLowerCase() : '', vendor };
}
// Ticket order dates come as dd/mm/yyyy or "3 Aug 2026" -> Date
function shopDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], 10, 0);
  const d = s ? new Date(String(s) + ' 10:00') : null;
  return d && !isNaN(d) ? d : null;
}
// Lines already with the warehouse (Shopify "In progress": Fulfillment accepted / in
// progress), where CW can no longer cancel and must use the GXO x Healf sheet. Set from each
// ticket's own wording: 22 the whole order, 32 the OOS item stuck in FIP (system error),
// 38 one of its two pre-order items (the other is still Unfulfilled and CW can edit it out).
const LINE_IN_PROGRESS = { 22: 'all', 32: 'all', 38: ['Ultimate Sampler Pack'] };

function shopBaseOrders(ticket) {
  return parseOrders(ticket).map(o => {
    const cancelled = /cancel/i.test(o.status || '');
    const orderFul = fulfilment(o.status);
    const lines = (o.items || '').split('\n').filter(l => l.trim()).map(shopLine).map(l => {
      // A line's own tag wins; untagged lines take the order's state (see sim-ticket conventions).
      let fs = l.status;
      if (!fs) fs = orderFul && orderFul.label === 'Fulfilled' ? 'fulfilled' : 'unfulfilled';
      const shipped = fs === 'fulfilled' || /shipped|deliver/.test(fs);
      const ip = LINE_IN_PROGRESS[Number(ticket.id)];
      const inProgress = !shipped && (ip === 'all' || (Array.isArray(ip) && ip.some(x => l.title.indexOf(x) === 0)) || /progress|accepted/.test(String(o.status || '').toLowerCase()));
      return Object.assign(l, { fulfilled: shipped, inProgress, preorder: /pre-?order/.test(fs), refundedQty: 0, removed: false });
    });
    const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
    const total = o.value ? shopNum(o.value) : subtotal;
    // Older single-order tickets carry no order date: place it a few days before the customer wrote.
    const sent = sentAt(ticket);
    const created = shopDate(o.date) || (sent ? new Date(sent.getTime() - 3 * 86400000) : placeholderOrderDate(ticket, o));
    return {
      ticketId: ticket.id, number: o.number, date: o.date || (created ? created.toLocaleDateString('en-GB') : ''), created,
      lines, subtotal, total,
      discount: total < subtotal - 0.005 ? +(subtotal - total).toFixed(2) : 0,
      shipping: total > subtotal + 0.005 ? +(total - subtotal).toFixed(2) : 0,
      cancelled, cancel: null, refunds: [], refunded: 0, comments: [],
      tags: spOrderTags(ticket, o), address: custAddress(ticket).lines.slice(), note: '',
      manual: false, events: [], hold: null, fulfillmentRequested: false, cancellationRequested: false, metafields: {}
    };
  });
}
function shopFulfilmentLabel(o) {
  if (o.cancelled) return 'Cancelled';
  const live = o.lines.filter(l => !l.removed && l.qty - l.refundedQty > 0);
  const f = live.filter(l => l.fulfilled).length;
  if (!live.length) return o.lines.some(l => l.fulfilled) ? 'Fulfilled' : 'Unfulfilled';
  if (f === live.length) return 'Fulfilled';
  if (f > 0) return 'Partially fulfilled';
  if (o.hold) return 'On hold';
  return live.every(l => l.inProgress) ? 'In progress' : 'Unfulfilled';
}
function shopPaymentLabel(o) {
  if (o.refunded >= o.total - 0.005 && o.refunded > 0) return 'Refunded';
  if (o.refunded > 0) return 'Partially refunded';
  if (o.cancelled && !o.cancel) return 'Voided';
  return 'Paid';
}
// Replay the trainee's actions over the ticket's orders, oldest first.
function applyShopActions(ticket, actions) {
  const orders = shopBaseOrders(ticket);
  const find = n => orders.find(o => o.number === n);
  (actions || []).filter(a => a.ticket_id === ticket.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
    .forEach(a => {
      const d = a.detail || {};
      const at = new Date(a.created_at);
      if (a.kind === 'create_order') {
        const lines = (d.lines || []).map(l => ({ title: l.title, productId: String(l.productId || ''), variantId: l.variantId ? String(l.variantId) : null,
          qty: l.qty || 1, price: Number(l.price) || 0, vendor: l.vendor || '', status: 'unfulfilled', fulfilled: false, preorder: !!l.preorder, refundedQty: 0, removed: false }));
        const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
        const disc = Math.min(subtotal, Number(d.discount_amount) || 0);
        orders.unshift({ ticketId: ticket.id, number: a.order_number, date: at.toLocaleDateString('en-GB'), created: at, lines, subtotal,
          discount: disc, shipping: Number(d.shipping) || 0, total: +(subtotal - disc + (Number(d.shipping) || 0)).toFixed(2),
          discountReason: d.discount_reason || '', shipName: d.shipping_name || '', cancelled: false, cancel: null, refunds: [], refunded: 0, comments: [],
          tags: (d.tags || []).slice(), address: (d.address || custAddress(ticket).lines).slice(), note: d.note || '',
          manual: true, events: [{ at, text: 'Order created manually from ' + (d.draft ? 'draft order ' + d.draft : 'Create order') + (d.from ? ' (duplicated from ' + d.from + ')' : '') }],
          hold: null, fulfillmentRequested: false, cancellationRequested: false, metafields: {} });
        orders[0].lines.forEach((l, i) => { const src = (d.lines || [])[i] || {}; l.sku = src.sku || ''; l.origPrice = src.origPrice != null ? Number(src.origPrice) : null; l.itemDiscountReason = src.itemDiscountReason || ''; });
        return;
      }
      const o = find(a.order_number); if (!o) return;
      if (a.kind === 'hold') { o.hold = { reason: d.reason || '', at }; o.events.push({ at, text: 'Fulfillment was put on hold' + (d.reason ? ' — ' + d.reason : '') }); return; }
      if (a.kind === 'release_hold') { o.hold = null; o.events.push({ at, text: 'Fulfillment hold was released' }); return; }
      if (a.kind === 'request_fulfillment') { o.fulfillmentRequested = true; o.events.push({ at, text: 'Fulfillment was requested from PFS Fulfillment Service' }); return; }
      if (a.kind === 'request_cancellation') { o.cancellationRequested = true; o.events.push({ at, text: 'Cancellation was requested from PFS Fulfillment Service' + (d.message ? ': "' + d.message + '"' : '') }); return; }
      if (a.kind === 'metafield') { o.metafields[d.key] = d.value; o.events.push({ at, text: 'Metafield "' + (d.label || d.key) + '" was set to ' + (d.value || '(blank)') }); return; }
      if (a.kind === 'cancel') {
        o.cancelled = true; o.cancel = { reason: d.reason, at, restock: d.restock, notify: d.notify };
        if (d.refund) { o.refunded = o.total; o.refunds.push({ at, amount: o.total, reason: 'Order cancelled', lines: [] }); o.lines.forEach(l => { l.refundedQty = l.qty; }); }
        o.events.push({ at, text: 'Order was cancelled — ' + (d.reason || 'no reason') + (d.refund ? '. ' + shopMoney(o.total) + ' refunded' : '') });
      } else if (a.kind === 'refund') {
        (d.lines || []).forEach(r => { const l = o.lines[r.idx]; if (l) l.refundedQty = Math.min(l.qty, l.refundedQty + (r.qty || 0)); });
        o.refunded = +(o.refunded + (Number(d.amount) || 0)).toFixed(2);
        o.refunds.push({ at, amount: Number(d.amount) || 0, reason: d.reason || '', lines: d.lines || [] });
        o.events.push({ at, text: shopMoney(d.amount) + ' was refunded' + (d.reason ? ' — ' + d.reason : '') });
      } else if (a.kind === 'edit_address') {
        o.address = (d.lines || []).slice(); o.events.push({ at, text: 'Shipping address was changed' });
      } else if (a.kind === 'comment') {
        o.comments.push({ at, text: d.text || '' });
      } else if (a.kind === 'tag') {
        (d.add || []).forEach(t => { if (o.tags.indexOf(t) === -1) o.tags.push(t); });
        o.tags = o.tags.filter(t => (d.remove || []).indexOf(t) === -1);
      } else if (a.kind === 'note') {
        o.note = d.text || '';
      } else if (a.kind === 'edit_order') {
        (d.remove || []).forEach(i => { if (o.lines[i]) o.lines[i].removed = true; });
        (d.add || []).forEach(l => o.lines.push({ title: l.title, productId: String(l.productId || ''), variantId: l.variantId ? String(l.variantId) : null, qty: l.qty || 1,
          price: Number(l.price) || 0, vendor: l.vendor || '', status: 'unfulfilled', fulfilled: false, preorder: !!l.preorder, refundedQty: 0, removed: false, added: true }));
        const before = o.total;
        o.subtotal = o.lines.filter(l => !l.removed).reduce((s, l) => s + l.price * l.qty, 0);
        o.total = +(o.subtotal - o.discount + o.shipping).toFixed(2);
        o.balance = +(o.total - before).toFixed(2);   // + owed by the customer, - owed to them
        o.events.push({ at, text: 'Order was edited — ' + a.summary.replace(/^Edited order \S+ — /, '') });
      }
    });
  return orders;
}
