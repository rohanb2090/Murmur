-- ════════════════════════════════════════════════════════════════════════════
-- Murmur — Supabase schema
--
-- Security model: rooms have no logins. The 22-char random slug in the invite
-- link IS the key. Row Level Security is ON with NO policies, so the anon key
-- cannot select/insert/update any table directly. All access goes through the
-- SECURITY DEFINER functions below, which require the slug and only ever touch
-- rows belonging to that slug's group.
--
-- Timestamps are epoch milliseconds (bigint) so offline devices can merge with
-- last-write-wins on updated_at. Money is integer paise.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.groups (
  id          uuid primary key,
  slug        text unique not null check (slug ~ '^[0-9A-Za-z]{16,64}$'),
  name        text not null check (char_length(name) between 1 and 80),
  created_at  bigint not null,
  updated_at  bigint not null
);

create table if not exists public.members (
  id          uuid primary key,
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  aliases     text[] not null default '{}',
  upi_id      text check (upi_id is null or upi_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$'),
  device_id   text,
  created_at  bigint not null,
  updated_at  bigint not null
);

create table if not exists public.expenses (
  id                uuid primary key,
  group_id          uuid not null references public.groups(id) on delete cascade,
  raw_input         text not null check (char_length(raw_input) <= 4000),
  capture_mode      text not null check (capture_mode in ('voice', 'ocr', 'text')),
  description       text not null default '' check (char_length(description) <= 120),
  amount_paise      bigint check (amount_paise is null or amount_paise > 0),
  paid_by           uuid references public.members(id) on delete set null,
  split_all         boolean not null default true,
  split_member_ids  uuid[] not null default '{}',
  status            text not null default 'unresolved' check (status in ('resolved', 'unresolved')),
  issues            text[] not null default '{}',
  receipt_thumb     text check (receipt_thumb is null or char_length(receipt_thumb) <= 60000),
  created_by        uuid references public.members(id) on delete set null,
  created_at        bigint not null,
  updated_at        bigint not null,
  deleted_at        bigint
);

create table if not exists public.payments (
  id            uuid primary key,
  group_id      uuid not null references public.groups(id) on delete cascade,
  from_id       uuid not null references public.members(id) on delete cascade,
  to_id         uuid not null references public.members(id) on delete cascade,
  amount_paise  bigint not null check (amount_paise > 0),
  created_at    bigint not null,
  updated_at    bigint not null,
  deleted_at    bigint,
  check (from_id <> to_id)
);

create index if not exists idx_members_group  on public.members(group_id);
create index if not exists idx_expenses_group on public.expenses(group_id, created_at desc);
create index if not exists idx_payments_group on public.payments(group_id);

-- Lock the tables: RLS on, no policies → no direct access for anon/authenticated.
alter table public.groups   enable row level security;
alter table public.members  enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
revoke all on public.groups, public.members, public.expenses, public.payments from anon, authenticated;

-- ── RPC: create_room ────────────────────────────────────────────────────────
create or replace function public.create_room(p_group jsonb, p_member jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into groups (id, slug, name, created_at, updated_at)
  values ((p_group->>'id')::uuid, p_group->>'slug', p_group->>'name',
          (p_group->>'created_at')::bigint, (p_group->>'updated_at')::bigint)
  on conflict (id) do nothing;

  if (p_member->>'group_id')::uuid <> (p_group->>'id')::uuid then
    raise exception 'member does not belong to this room';
  end if;

  insert into members (id, group_id, name, aliases, upi_id, device_id, created_at, updated_at)
  values ((p_member->>'id')::uuid, (p_member->>'group_id')::uuid, p_member->>'name',
          coalesce(array(select jsonb_array_elements_text(p_member->'aliases')), '{}'),
          nullif(p_member->>'upi_id', ''), p_member->>'device_id',
          (p_member->>'created_at')::bigint, (p_member->>'updated_at')::bigint)
  on conflict (id) do nothing;
end $$;

-- ── RPC: get_room ───────────────────────────────────────────────────────────
create or replace function public.get_room(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when g.id is null then null else jsonb_build_object(
    'group',    to_jsonb(g),
    'members',  coalesce((select jsonb_agg(to_jsonb(m)) from members m where m.group_id = g.id), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from expenses e where e.group_id = g.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from payments p where p.group_id = g.id), '[]'::jsonb)
  ) end
  from (select * from groups where slug = p_slug) g
  right join (select 1) one on true;
$$;

-- ── RPC: push_changes (last-write-wins on updated_at) ──────────────────────
create or replace function public.push_changes(p_slug text, p_members jsonb, p_expenses jsonb, p_payments jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  select id into gid from groups where slug = p_slug;
  if gid is null then raise exception 'room not found'; end if;

  -- Every row must belong to this slug's group.
  if exists (select 1 from jsonb_array_elements(coalesce(p_members, '[]')) x where (x->>'group_id')::uuid <> gid)
     or exists (select 1 from jsonb_array_elements(coalesce(p_expenses, '[]')) x where (x->>'group_id')::uuid <> gid)
     or exists (select 1 from jsonb_array_elements(coalesce(p_payments, '[]')) x where (x->>'group_id')::uuid <> gid) then
    raise exception 'row does not belong to this room';
  end if;

  if jsonb_array_length(coalesce(p_expenses, '[]')) > 500 then raise exception 'too many rows'; end if;

  insert into members (id, group_id, name, aliases, upi_id, device_id, created_at, updated_at)
  select (x->>'id')::uuid, gid, x->>'name',
         coalesce(array(select jsonb_array_elements_text(x->'aliases')), '{}'),
         nullif(x->>'upi_id', ''), x->>'device_id',
         (x->>'created_at')::bigint, (x->>'updated_at')::bigint
  from jsonb_array_elements(coalesce(p_members, '[]')) x
  on conflict (id) do update set
    name = excluded.name, aliases = excluded.aliases, upi_id = excluded.upi_id,
    device_id = coalesce(members.device_id, excluded.device_id), updated_at = excluded.updated_at
  where members.group_id = gid and excluded.updated_at > members.updated_at;

  insert into expenses (id, group_id, raw_input, capture_mode, description, amount_paise, paid_by, split_all,
                        split_member_ids, status, issues, receipt_thumb, created_by, created_at, updated_at, deleted_at)
  select (x->>'id')::uuid, gid, x->>'raw_input', x->>'capture_mode', coalesce(x->>'description', ''),
         (x->>'amount_paise')::bigint,
         (select m.id from members m where m.id = (x->>'paid_by')::uuid and m.group_id = gid),
         coalesce((x->>'split_all')::boolean, true),
         coalesce(array(select (v)::uuid from jsonb_array_elements_text(x->'split_member_ids') v), '{}'),
         x->>'status',
         coalesce(array(select jsonb_array_elements_text(x->'issues')), '{}'),
         x->>'receipt_thumb',
         (select m.id from members m where m.id = (x->>'created_by')::uuid and m.group_id = gid),
         (x->>'created_at')::bigint, (x->>'updated_at')::bigint, (x->>'deleted_at')::bigint
  from jsonb_array_elements(coalesce(p_expenses, '[]')) x
  on conflict (id) do update set
    description = excluded.description, amount_paise = excluded.amount_paise, paid_by = excluded.paid_by,
    split_all = excluded.split_all, split_member_ids = excluded.split_member_ids, status = excluded.status,
    issues = excluded.issues, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where expenses.group_id = gid and excluded.updated_at > expenses.updated_at;

  insert into payments (id, group_id, from_id, to_id, amount_paise, created_at, updated_at, deleted_at)
  select (x->>'id')::uuid, gid, (x->>'from_id')::uuid, (x->>'to_id')::uuid, (x->>'amount_paise')::bigint,
         (x->>'created_at')::bigint, (x->>'updated_at')::bigint, (x->>'deleted_at')::bigint
  from jsonb_array_elements(coalesce(p_payments, '[]')) x
  where exists (select 1 from members m where m.id = (x->>'from_id')::uuid and m.group_id = gid)
    and exists (select 1 from members m where m.id = (x->>'to_id')::uuid and m.group_id = gid)
  on conflict (id) do update set deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
  where payments.group_id = gid and excluded.updated_at > payments.updated_at;

  update groups set updated_at = greatest(updated_at, (extract(epoch from now()) * 1000)::bigint) where id = gid;
end $$;

revoke all on function public.create_room(jsonb, jsonb) from public;
revoke all on function public.get_room(text) from public;
revoke all on function public.push_changes(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_room(jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_room(text) to anon, authenticated;
grant execute on function public.push_changes(text, jsonb, jsonb, jsonb) to anon, authenticated;
