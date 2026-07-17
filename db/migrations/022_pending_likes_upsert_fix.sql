-- =============================================================================
--  022 · pending_likes — resync sur UPSERT (fix « like fantôme », 17/07)
--
--  swipes est un UPSERT (swipe.model.record : on conflict swiper_id,target_id).
--  Le trigger 020 était `after insert` seulement → un changement d'avis sur une
--  paire déjà swipée (ex. like depuis les Coups de cœur, puis pass dans le deck)
--  est un UPDATE que le trigger IGNORAIT : le likeur restait dans les « Likes »
--  de la cible alors qu'il l'avait passée.
--
--  Fix : (1) le trigger écoute AUSSI UPDATE ; (2) sur un swipe NON-like, on
--  SUPPRIME le pending correspondant (l'état de pending_likes = le DERNIER swipe).
--
--  Idempotente.
-- =============================================================================

create or replace function public.sync_pending_likes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select code into v_code from public.swipe_actions where id = new.action_id;

  -- 1. Le swipe S→T est une RÉPONSE au like éventuel de T→S : T quitte les pending de S.
  delete from public.pending_likes
   where target_id = new.swiper_id and swiper_id = new.target_id;

  -- 2. Le swipe S→T définit si S est un like EN ATTENTE pour T (état = dernier swipe).
  if v_code in ('like', 'super_like')
     and not exists (
       select 1 from public.swipes s
       where s.swiper_id = new.target_id and s.target_id = new.swiper_id
     ) then
    insert into public.pending_likes (target_id, swiper_id, action_code, created_at)
    values (new.target_id, new.swiper_id, v_code, new.created_at)
    on conflict (target_id, swiper_id)
      do update set action_code = excluded.action_code, created_at = excluded.created_at;
  else
    -- pass (ou T a déjà répondu) → S n'est PAS/PLUS un like en attente pour T.
    delete from public.pending_likes
     where target_id = new.target_id and swiper_id = new.swiper_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_pending_likes on public.swipes;
create trigger trg_sync_pending_likes
  after insert or update on public.swipes
  for each row execute function public.sync_pending_likes();

-- ── Rattrapage des fantômes DÉJÀ en base ─────────────────────────────────────
-- Tout pending(T, S) dont le dernier swipe S→T n'est plus un like/super_like
-- (ou n'existe plus) est un fantôme laissé par l'ancien trigger : on le purge.
delete from public.pending_likes pl
where not exists (
  select 1 from public.swipes s
  join public.swipe_actions a on a.id = s.action_id
  where s.swiper_id = pl.swiper_id
    and s.target_id = pl.target_id
    and a.code in ('like', 'super_like')
);
