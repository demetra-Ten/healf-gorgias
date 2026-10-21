-- SHOPIFY SIMULATOR — run once in the Supabase SQL editor.
-- Adds the frozen catalogue, the per-ticket stock state, and the log of what a trainee
-- does in the Shopify sim. Same lockdown as everything else: logged-in users only.

-- 1. The catalogue. A frozen snapshot of healf.com, refreshed only when asked for
--    (see source-mapping/load-shop-catalogue.py). Products that have since left the
--    store but still appear on a ticket's order are kept with status 'archived', so a
--    line item never points at nothing.
create table if not exists shop_products (
  id            bigint primary key,          -- the real Shopify product id
  title         text not null,
  handle        text,
  vendor        text,
  product_type  text,
  tags          text[] not null default '{}',
  description   text,
  image_url     text,
  status        text not null default 'active' check (status in ('active','archived')),
  preorder      boolean not null default false,
  variants      jsonb not null default '[]',  -- [{id,title,sku,price,compare_at,available}]
  published_at  timestamptz,
  snapshot_at   timestamptz not null default now()
);
create index if not exists shop_products_title_idx  on shop_products (lower(title));
create index if not exists shop_products_vendor_idx on shop_products (lower(vendor));

-- 2. Stock as it stood when the customer wrote. The catalogue is one snapshot, but a
--    ticket about an out-of-stock serum must show it out of stock, whatever the store
--    says today. One row per product a ticket is about; anything without a row falls
--    back to the catalogue snapshot.
create table if not exists shop_ticket_products (
  ticket_id     int not null references tickets(id),
  product_id    bigint not null,            -- negative = a seed-only product (synthetic Fulfilment tickets)
  line_title    text,                         -- the order line it belongs to, for lines with no product link
  availability  text not null check (availability in ('in_stock','out_of_stock','preorder','discontinued')),
  eta           text,                         -- e.g. 'Back in stock w/c 9 June'
  price         numeric,                      -- price on the day, if it differs
  note          text,                         -- why this state was set (for Demetra, never shown)
  primary key (ticket_id, product_id)
);

-- 3. Everything a trainee does in the Shopify sim: cancel, refund, edit address, note,
--    order note, tag, create order, edit order. Rows with no submission_id are the attempt in
--    progress; Send & Close stamps them with the submission and they go to the scorer.
create table if not exists shop_actions (
  id             bigserial primary key,
  trainee_id     int not null references trainees(id),
  ticket_id      int not null references tickets(id),
  submission_id  int references submissions(id),
  kind           text not null check (kind in ('cancel','refund','edit_address','comment','note','tag','create_order','edit_order')),
  order_number   text,
  detail         jsonb not null default '{}',
  summary        text not null,               -- plain-English line, what the scorer reads
  created_at     timestamptz not null default now()
);
create index if not exists shop_actions_attempt_idx on shop_actions (trainee_id, ticket_id);

-- The scorer's view of what was done in Shopify, kept on the submission for review.
alter table submissions add column if not exists shopify_actions text;

alter table shop_products        enable row level security;
alter table shop_ticket_products enable row level security;
alter table shop_actions         enable row level security;

create policy "auth read shop_products"         on shop_products        for select to authenticated using (true);
create policy "auth read shop_ticket_products"  on shop_ticket_products for select to authenticated using (true);
create policy "auth read shop_actions"          on shop_actions         for select to authenticated using (true);
create policy "auth insert shop_actions"        on shop_actions         for insert to authenticated with check (true);
create policy "auth update shop_actions"        on shop_actions         for update to authenticated using (true);
-- No delete policy: like real Shopify, a cancel or refund cannot be taken back.
-- Catalogue and stock-state writes go through the secret key from the loader script.
