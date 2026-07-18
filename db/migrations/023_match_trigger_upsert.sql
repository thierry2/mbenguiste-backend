-- =============================================================================
--  023 · handle_swipe — match sur UPSERT + garde block + rattrapage (18/07)
--
--  Même classe de bug que le « like fantôme » corrigé en 022 pour pending_likes,
--  mais côté MATCH : swipes est un UPSERT (swipe.model.record) et le trigger
--  n'écoutait que INSERT. Conséquences en prod :
--    · un changement d'avis (pass puis re-like) face à un like en attente ne
--      créait JAMAIS le match — l'app disait « c'est réciproque », la liste des
--      conversations restait vide ;
--    · un re-match après unmatch tombait sur `on conflict do nothing` : la ligne
--      restait is_active = false → match annoncé mais invisible.
--
--  Fix : (1) le trigger écoute AUSSI UPDATE ; (2) `on conflict do update set
--  is_active = true` — un like frais rouvre le MÊME fil après un unmatch ;
--  (3) garde `blocks` : jamais de match (ni de résurrection) entre bloqués —
--  indispensable maintenant que le conflit réactive.
--
--  Contrat testé : backend/tests/matchs.test.js (PGlite). Idempotente.
-- =============================================================================

create or replace function public.handle_swipe() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action_code text;
  v_reciprocal  boolean;
  v_low  uuid;
  v_high uuid;
begin
  select code into v_action_code from public.swipe_actions where id = new.action_id;
  if v_action_code = 'pass' then
    return new;                                           -- a pass never creates a match
  end if;

  select exists (
    select 1
    from public.swipes s
    join public.swipe_actions a on a.id = s.action_id
    where s.swiper_id = new.target_id
      and s.target_id = new.swiper_id
      and a.code in ('like', 'super_like')
  ) into v_reciprocal;

  if v_reciprocal
     -- Jamais de match (ni de résurrection) entre bloqués, quel que soit le sens.
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = new.swiper_id and b.blocked_id = new.target_id)
          or (b.blocker_id = new.target_id and b.blocked_id = new.swiper_id)
     ) then
    if new.swiper_id < new.target_id then
      v_low := new.swiper_id; v_high := new.target_id;
    else
      v_low := new.target_id; v_high := new.swiper_id;
    end if;

    -- Réactivation voulue : si la paire avait un match désactivé par un unmatch
    -- (pas un block — exclu ci-dessus), un like frais rouvre le MÊME fil.
    insert into public.matches (user_low, user_high, last_message_at)
    values (v_low, v_high, now())
    on conflict (user_low, user_high) do update set is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handle_swipe on public.swipes;
create trigger trg_handle_swipe
  after insert or update on public.swipes
  for each row execute function public.handle_swipe();

-- ── Rattrapage des matchs JAMAIS créés par l'ancien trigger ──────────────────
-- Paires mutuellement likées (dernier swipe des DEUX côtés = like/super_like),
-- non bloquées, sans AUCUNE ligne match : on crée le match manquant.
-- `do nothing` sur conflit : on ne ressuscite PAS ici les unmatchs volontaires —
-- seule la voie trigger (un like FRAIS) réactive un fil coupé.
insert into public.matches (user_low, user_high, last_message_at)
select s1.swiper_id, s1.target_id, now()
from public.swipes s1
join public.swipe_actions a1 on a1.id = s1.action_id
join public.swipes s2 on s2.swiper_id = s1.target_id and s2.target_id = s1.swiper_id
join public.swipe_actions a2 on a2.id = s2.action_id
where s1.swiper_id < s1.target_id                          -- une seule fois par paire
  and a1.code in ('like', 'super_like')
  and a2.code in ('like', 'super_like')
  and not exists (
    select 1 from public.blocks b
    where (b.blocker_id = s1.swiper_id and b.blocked_id = s1.target_id)
       or (b.blocker_id = s1.target_id and b.blocked_id = s1.swiper_id)
  )
on conflict (user_low, user_high) do nothing;
