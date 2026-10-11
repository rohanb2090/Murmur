-- Murmur Database Schema (Supabase / PostgreSQL)

-- 1. Groups Table
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamp with time zone default now()
);

-- 2. Members Table
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  upi_id text,
  device_id text not null,
  created_at timestamp with time zone default now()
);

-- 3. Expenses Table
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  raw_input text not null,
  capture_mode text check (capture_mode in ('voice', 'ocr', 'text')),
  amount numeric(10, 2),
  paid_by uuid references members(id),
  split_type text default 'equal',
  split_members jsonb default '[]'::jsonb, -- Array of member UUIDs
  is_verified boolean default false,
  receipt_url text,
  created_at timestamp with time zone default now()
);

-- Indexes for performance
create index if not exists idx_members_group on members(group_id);
create index if not exists idx_expenses_group on expenses(group_id);