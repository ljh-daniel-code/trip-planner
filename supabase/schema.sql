-- =====================================================================
-- 여행 플래너 DB 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성되어 있습니다.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- 프로필 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '여행자',
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'nickname',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'preferred_username',
      split_part(new.email, '@', 1),
      '여행자'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 여행 ----------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  regions jsonb not null default '[]'::jsonb,   -- [{name, full, lat, lng}]
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  role text not null check (role in ('editor','viewer')),
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked boolean not null default false
);

create table if not exists public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index int not null default 0,           -- 0 = 1일차
  position int not null default 0,
  title text not null,
  time text,
  memo text,
  place_name text,
  address text,
  lat double precision,
  lng double precision,
  kakao_place_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  text text not null,
  checked boolean not null default false,
  position int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  content text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  amount bigint not null check (amount >= 0),
  category text not null default '기타',
  paid_by uuid references auth.users(id) on delete set null,
  participants uuid[] not null default '{}',
  spent_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id bigserial primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,            -- insert | update | delete
  entity text not null,            -- 테이블 이름
  entity_id text,
  label text,                      -- 사람이 읽을 이름 (예: 일정 제목)
  changes jsonb,                   -- {필드: [이전, 이후]}
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_trip_idx on public.activity_logs (trip_id, created_at desc);

-- ---------- 권한 헬퍼 ----------
create or replace function public.trip_role(t uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.trip_members where trip_id = t and user_id = auth.uid()
$$;

create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid())
$$;

create or replace function public.can_edit(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members
                 where trip_id = t and user_id = auth.uid() and role in ('owner','editor'))
$$;

-- 여행을 만들면 만든 사람을 owner 로 등록
create or replace function public.add_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips
  for each row execute function public.add_owner_member();

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- 수정 기록 (누가, 무엇을, 어떻게) ----------
create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  old_j jsonb;
  new_j jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
  t uuid;
  lbl text;
  ignored text[] := array['updated_at','created_at','id','trip_id','created_by','position','owner_id'];
begin
  if tg_op = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  t := case when tg_table_name = 'trips' then (rec->>'id')::uuid else (rec->>'trip_id')::uuid end;
  lbl := coalesce(rec->>'title', rec->>'text', left(rec->>'content', 30));

  -- 여행 자체를 삭제할 때는 기록하지 않음 (cascade 로 함께 지워짐)
  if tg_op = 'DELETE' and not exists (select 1 from public.trips where id = t) then
    return old;
  end if;

  if tg_op = 'UPDATE' then
    old_j := to_jsonb(old); new_j := to_jsonb(new);
    for k in select jsonb_object_keys(new_j) loop
      if not (k = any(ignored)) and (old_j->k) is distinct from (new_j->k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(old_j->k, new_j->k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;   -- 순서 변경 등 의미 없는 변경은 생략
  elsif tg_op = 'INSERT' then
    diff := null;
  else
    diff := null;
  end if;

  insert into public.activity_logs (trip_id, user_id, action, entity, entity_id, label, changes)
  values (t, auth.uid(), lower(tg_op), tg_table_name, rec->>'id', lbl, diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare tbl text;
begin
  foreach tbl in array array['trips','itinerary_items','checklist_items','notes','expenses'] loop
    execute format('drop trigger if exists %I_touch on public.%I', tbl, tbl);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', tbl, tbl);
    execute format('drop trigger if exists %I_log on public.%I', tbl, tbl);
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function public.log_change()', tbl, tbl);
  end loop;
end $$;

-- 일행 참여/역할 변경/나가기 기록
create or replace function public.log_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec record;
begin
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;
  if not exists (select 1 from public.trips where id = rec.trip_id) then return null; end if;
  if tg_op = 'INSERT' and rec.role = 'owner' then return null; end if;
  insert into public.activity_logs (trip_id, user_id, action, entity, entity_id, label, changes)
  values (rec.trip_id, auth.uid(), lower(tg_op), 'trip_members', rec.user_id::text,
          (select nickname from public.profiles where id = rec.user_id),
          case when tg_op = 'UPDATE' then jsonb_build_object('role', jsonb_build_array(old.role, new.role))
               else jsonb_build_object('role', jsonb_build_array(null, rec.role)) end);
  return null;
end $$;
drop trigger if exists trip_members_log on public.trip_members;
create trigger trip_members_log after insert or update or delete on public.trip_members
  for each row execute function public.log_member_change();

-- ---------- 초대 ----------
-- 초대 링크 정보 보기 (아직 일행이 아니어도 로그인만 되어 있으면 가능)
create or replace function public.get_invite(p_token text)
returns table (trip_id uuid, title text, start_date date, end_date date, role text,
               inviter text, valid boolean, already_member boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.start_date, t.end_date, i.role,
         (select nickname from public.profiles where id = i.created_by),
         (not i.revoked and i.expires_at > now()),
         exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id = auth.uid())
  from public.trip_invites i join public.trips t on t.id = i.trip_id
  where i.token = p_token
$$;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.trip_invites;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into inv from public.trip_invites where token = p_token;
  if inv.id is null then raise exception '존재하지 않는 초대 링크입니다'; end if;
  if inv.revoked or inv.expires_at < now() then raise exception '만료되었거나 취소된 초대 링크입니다'; end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (inv.trip_id, auth.uid(), inv.role)
  on conflict (trip_id, user_id) do update
    set role = case when public.trip_members.role = 'viewer' and excluded.role = 'editor'
                    then 'editor' else public.trip_members.role end;
  return inv.trip_id;
end $$;

grant execute on function public.get_invite(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------- RLS (행 단위 권한) ----------
alter table public.profiles        enable row level security;
alter table public.trips           enable row level security;
alter table public.trip_members    enable row level security;
alter table public.trip_invites    enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.checklist_items enable row level security;
alter table public.notes           enable row level security;
alter table public.expenses        enable row level security;
alter table public.activity_logs   enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (public.is_member(id) or owner_id = auth.uid());
drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit(id)) with check (public.can_edit(id));
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated using (owner_id = auth.uid());

drop policy if exists members_select on public.trip_members;
create policy members_select on public.trip_members for select to authenticated using (public.is_member(trip_id));
drop policy if exists members_update on public.trip_members;
create policy members_update on public.trip_members for update to authenticated
  using (public.trip_role(trip_id) = 'owner' and role <> 'owner')
  with check (role in ('editor','viewer'));
drop policy if exists members_delete on public.trip_members;
create policy members_delete on public.trip_members for delete to authenticated
  using ((user_id = auth.uid() and role <> 'owner')
         or (public.trip_role(trip_id) = 'owner' and role <> 'owner'));

drop policy if exists invites_select on public.trip_invites;
create policy invites_select on public.trip_invites for select to authenticated using (public.can_edit(trip_id));
drop policy if exists invites_insert on public.trip_invites;
create policy invites_insert on public.trip_invites for insert to authenticated
  with check (public.can_edit(trip_id) and created_by = auth.uid());
drop policy if exists invites_update on public.trip_invites;
create policy invites_update on public.trip_invites for update to authenticated using (public.can_edit(trip_id));

do $$
declare tbl text;
begin
  foreach tbl in array array['itinerary_items','checklist_items','notes','expenses'] loop
    execute format('drop policy if exists %I_select on public.%I', tbl, tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.is_member(trip_id))', tbl, tbl);
    execute format('drop policy if exists %I_insert on public.%I', tbl, tbl);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.can_edit(trip_id))', tbl, tbl);
    execute format('drop policy if exists %I_update on public.%I', tbl, tbl);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.can_edit(trip_id)) with check (public.can_edit(trip_id))', tbl, tbl);
    execute format('drop policy if exists %I_delete on public.%I', tbl, tbl);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.can_edit(trip_id))', tbl, tbl);
  end loop;
end $$;

drop policy if exists logs_select on public.activity_logs;
create policy logs_select on public.activity_logs for select to authenticated using (public.is_member(trip_id));
-- activity_logs 에는 insert/update/delete 정책이 없음 → 앱에서 위조·삭제 불가 (트리거만 기록)

-- ---------- API 접근 권한 (실제 허용 범위는 위 RLS 정책이 결정) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.trips, public.trip_members, public.trip_invites,
  public.itinerary_items, public.checklist_items, public.notes, public.expenses
  to authenticated;
grant select on public.activity_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 실시간 동기화 ----------
do $$
declare tbl text;
begin
  foreach tbl in array array['trips','trip_members','itinerary_items','checklist_items','notes','expenses','activity_logs'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
