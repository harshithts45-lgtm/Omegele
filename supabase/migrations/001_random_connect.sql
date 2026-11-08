-- Run with `supabase db push` or paste into the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.matchmaking_queue (
  id uuid primary key default gen_random_uuid(), session_id uuid not null unique,
  country_code text not null check (country_code = 'ALL' or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'waiting' check (status in ('waiting', 'matched')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Supports the UI's explicit worldwide value. The first statement is harmless on a fresh database.
alter table public.matchmaking_queue drop constraint if exists matchmaking_queue_country_code_check;
alter table public.matchmaking_queue add constraint matchmaking_queue_country_code_check
  check (country_code = 'ALL' or country_code ~ '^[A-Z]{2}$');
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(), participant_one uuid not null,
  participant_two uuid not null, status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(), ended_at timestamptz,
  check (participant_one <> participant_two)
);
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(), reporter_session uuid not null, reported_session uuid not null,
  reason text not null check (char_length(reason) between 3 and 500), created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'actioned')),
  check (reporter_session <> reported_session)
);
alter table public.matchmaking_queue enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.reports enable row level security;
-- Direct client reads/writes are denied. The RPCs below are the only queue path; reports may be inserted anonymously.
drop policy if exists "anonymous report insertion" on public.reports;
drop policy if exists "authenticated report insertion" on public.reports;
create policy "anonymous report insertion" on public.reports for insert to anon with check (true);
create policy "authenticated report insertion" on public.reports for insert to authenticated with check (true);

create or replace function public.join_matchmaking_queue(p_session_id uuid, p_country_code text)
returns table(chat_session_id uuid, partner_session_id uuid, initiator boolean)
language plpgsql security definer set search_path = public as $$
declare candidate public.matchmaking_queue%rowtype; created_session uuid; prior_partner uuid;
begin
  if p_country_code <> 'ALL' and p_country_code !~ '^[A-Z]{2}$' then raise exception 'Invalid country'; end if;
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  -- A selected candidate discovers its match on its next poll. This also makes retries idempotent.
  return query select s.id,
    case when s.participant_one = p_session_id then s.participant_two else s.participant_one end,
    s.participant_one = p_session_id
  from chat_sessions s where s.status = 'active'
    and (s.participant_one = p_session_id or s.participant_two = p_session_id)
  order by s.created_at desc limit 1;
  if found then return; end if;
  -- Per-session throttle. A client may poll at most once every two seconds.
  if exists (select 1 from matchmaking_queue where session_id = p_session_id and status = 'waiting' and updated_at > now() - interval '2 seconds') then
    return;
  end if;
  select case when participant_one = p_session_id then participant_two else participant_one end into prior_partner
  from chat_sessions where status = 'ended' and (participant_one = p_session_id or participant_two = p_session_id)
  order by ended_at desc nulls last limit 1;
  insert into matchmaking_queue(session_id, country_code, status, updated_at) values (p_session_id, p_country_code, 'waiting', now())
  on conflict (session_id) do update set country_code = excluded.country_code, status = 'waiting', updated_at = now();
  select * into candidate from matchmaking_queue q where q.status = 'waiting' and q.session_id <> p_session_id
    and q.session_id is distinct from prior_partner and (q.country_code = p_country_code or q.country_code = 'ALL' or p_country_code = 'ALL')
  order by q.created_at for update skip locked limit 1;
  if candidate.session_id is null then return; end if;
  update matchmaking_queue set status = 'matched', updated_at = now() where session_id in (p_session_id, candidate.session_id);
  insert into chat_sessions(participant_one, participant_two) values (p_session_id, candidate.session_id) returning id into created_session;
  return query select created_session, candidate.session_id, true;
end $$;
create or replace function public.leave_matchmaking_queue(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from matchmaking_queue where session_id = p_session_id and status = 'waiting';
  update chat_sessions set status = 'ended', ended_at = now() where status = 'active' and (participant_one = p_session_id or participant_two = p_session_id);
end $$;
grant execute on function public.join_matchmaking_queue(uuid, text), public.leave_matchmaking_queue(uuid) to anon;
grant execute on function public.join_matchmaking_queue(uuid, text), public.leave_matchmaking_queue(uuid) to authenticated;

-- Required because the WebRTC hook uses private Supabase Realtime Broadcast channels.
-- The chat-session UUID is unguessable and is never displayed in the UI.
drop policy if exists "authenticated chat broadcast receive" on realtime.messages;
drop policy if exists "authenticated chat broadcast send" on realtime.messages;
create policy "authenticated chat broadcast receive" on realtime.messages
  for select to authenticated using (realtime.topic() like 'chat:%');
create policy "authenticated chat broadcast send" on realtime.messages
  for insert to authenticated with check (realtime.topic() like 'chat:%');
-- Schedule separately with pg_cron (or an Edge Function) in production:
-- delete from matchmaking_queue where status = 'waiting' and updated_at < now() - interval '2 minutes';
