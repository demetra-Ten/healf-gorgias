-- SHOPIFY SIMULATOR, PART 2 — run once in the Supabase SQL editor (2026-10-21).
-- Lets the Shopify sim record the rest of the Trainual Shopify SOPs, and search by SKU.
-- Nothing existing changes: it only widens what can be saved and adds one column.

-- 1. More kinds of action a trainee can take in the Shopify sim.
alter table shop_actions drop constraint if exists shop_actions_kind_check;
alter table shop_actions add constraint shop_actions_kind_check check (kind in (
  'cancel', 'refund', 'edit_address', 'comment', 'note', 'tag', 'create_order', 'edit_order',
  'draft_order',          -- Create order > Save (a draft, e.g. a paid shipping upgrade)
  'invoice',              -- Draft > Share > copy invoice link
  'metafield',            -- e.g. Original order number on a replacement MO
  'hold', 'release_hold', -- Mark as on hold / Release hold
  'request_fulfillment',  -- the button CW must never press after an MO
  'request_cancellation', -- the button CW must never press on an In Progress order
  'gift_card',            -- Gift cards > Create gift card
  'discount'              -- Discounts > Create discount (code)
));

-- 2. Every SKU of a product in one searchable column, so "search by SKU" works as on Shopify.
alter table shop_products add column if not exists skus text;
update shop_products set skus = (
  select string_agg(v->>'sku', ' ') from jsonb_array_elements(variants) v where coalesce(v->>'sku', '') <> ''
) where skus is null;
create index if not exists shop_products_skus_idx on shop_products (lower(skus));
