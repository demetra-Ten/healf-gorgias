-- Run this in your Supabase SQL editor

create table categories (
  id serial primary key,
  name text not null,
  order_index int not null,
  trainual_link text
);

create table trainees (
  id serial primary key,
  name text not null,
  email text not null unique,
  pin text not null,
  current_category_id int references categories(id),
  created_at timestamptz default now()
);

create table tickets (
  id serial primary key,
  category_id int references categories(id),
  customer_name text not null,
  customer_email text not null,
  order_number text,
  subject text not null,
  message text not null,
  order_value text,
  order_status text,
  loyalty_tier text,
  ideal_response text
);

create table submissions (
  id serial primary key,
  trainee_id int references trainees(id),
  ticket_id int references tickets(id),
  reply_text text not null,
  submitted_at timestamptz default now(),
  score int,
  feedback text,
  marked_at timestamptz
);

-- Seed categories
insert into categories (name, order_index, trainual_link) values
  ('Fulfilment Issues',              1, null),
  ('GXO and Supplier Issues',        2, null),
  ('Returns, Gift Cards and Refunds',3, null),
  ('Discounts',                      4, null),
  ('Subscriptions',                  5, null),
  ('UK Delivery Issues',             6, null),
  ('International Orders',           7, null);

-- Enable Row Level Security and allow anon reads/writes for training purposes
alter table categories   enable row level security;
alter table trainees     enable row level security;
alter table tickets      enable row level security;
alter table submissions  enable row level security;

create policy "public read categories"  on categories  for select using (true);
create policy "public read trainees"    on trainees    for select using (true);
create policy "public read tickets"     on tickets     for select using (true);
create policy "public insert submissions" on submissions for insert with check (true);
create policy "public read submissions"   on submissions for select using (true);
create policy "public update submissions" on submissions for update using (true);
create policy "public insert trainees"  on trainees    for insert with check (true);
create policy "public update trainees"  on trainees    for update using (true);
create policy "public insert tickets"   on tickets     for insert with check (true);
create policy "public delete tickets"   on tickets     for delete using (true);
