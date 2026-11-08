-- Apply this migration when 001_random_connect.sql has already been run in Supabase.
-- It is intentionally idempotent so it is also safe after a fresh setup.
alter table public.matchmaking_queue drop constraint if exists matchmaking_queue_country_code_check;
alter table public.matchmaking_queue add constraint matchmaking_queue_country_code_check
  check (country_code = 'ALL' or country_code ~ '^[A-Z]{2}$');

create or replace function public.join_matchmaking_queue(p_session_id uuid, p_country_code text)
returns table(chat_session_id uuid, partner_session_id uuid, initiator boolean)
language plpgsql security definer set search_path = public as $$
declare candidate public.matchmaking_queue%rowtype; created_session uuid; prior_partner uuid;
begin
  if p_country_code <> 'ALL' and p_country_code !~ '^[A-Z]{2}$' then raise exception 'Invalid country'; end if;
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  return query select s.id, case when s.participant_one = p_session_id then s.participant_two else s.participant_one end,
    s.participant_one = p_session_id from chat_sessions s where s.status = 'active'
    and (s.participant_one = p_session_id or s.participant_two = p_session_id) order by s.created_at desc limit 1;
  if found then return; end if;
  if exists (select 1 from matchmaking_queue where session_id = p_session_id and status = 'waiting' and updated_at > now() - interval '2 seconds') then return; end if;
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

drop policy if exists "authenticated report insertion" on public.reports;
create policy "authenticated report insertion" on public.reports
  for insert to authenticated with check (true);

grant execute on function public.join_matchmaking_queue(uuid, text), public.leave_matchmaking_queue(uuid) to authenticated;

drop policy if exists "authenticated chat broadcast receive" on realtime.messages;
drop policy if exists "authenticated chat broadcast send" on realtime.messages;
create policy "authenticated chat broadcast receive" on realtime.messages
  for select to authenticated using (realtime.topic() like 'chat:%');
create policy "authenticated chat broadcast send" on realtime.messages
  for insert to authenticated with check (realtime.topic() like 'chat:%');
