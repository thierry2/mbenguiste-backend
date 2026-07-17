-- =============================================================================
--  020 · pending_likes — agrégat TEMPS RÉEL des likes reçus non répondus (17/07)
--
--  L'onglet « Likes » lisait, à chaque ouverture, TOUS mes swipes en mémoire
--  pour un NOT IN (10k+ lignes chez un power-user). On le remplace par une table
--  maintenue par TRIGGER (comme le match mutuel) : lecture `where target_id`,
--  index, instantané. Temps réel — pas de fantômes (un like/une réponse apparaît
--  ou disparaît aussitôt), contrairement à une vue matérialisée périodique.
--
--  Invariant : pending_likes(T, S) existe  ⟺  S a liké/super-liké T
--              ET T n'a pas swipé S  ET aucun blocage entre eux.
--
--  RLS : FERMÉ au client (agrégat serveur). Idempotente.
-- =============================================================================

create table if not exists public.pending_likes (
  target_id    uuid not null references public.profiles(id) on delete cascade,
  swiper_id    uuid not null references public.profiles(id) on delete cascade,
  action_code  text not null,                 -- 'like' | 'super_like'
  created_at   timestamptz not null default now(),
  primary key (target_id, swiper_id)           -- (target_id, …) sert d'index de lecture
);

-- ── Trigger sur swipes : entretient les deux faces d'un coup ──────────────────
create or replace function public.sync_pending_likes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select code into v_code from public.swipe_actions where id = new.action_id;

  -- Le swipe de NEW.swiper → NEW.target est une RÉPONSE au like éventuel de
  -- target → swiper : ce dernier quitte les pending du swipeur.
  delete from public.pending_likes
   where target_id = new.swiper_id and swiper_id = new.target_id;

  -- Un like/super-like crée un pending pour la cible — SAUF si la cible a déjà
  -- swipé le likeur (elle a déjà « répondu » : match ou pass antérieur).
  if v_code in ('like', 'super_like')
     and not exists (
       select 1 from public.swipes s
       where s.swiper_id = new.target_id and s.target_id = new.swiper_id
     ) then
    insert into public.pending_likes (target_id, swiper_id, action_code, created_at)
    values (new.target_id, new.swiper_id, v_code, new.created_at)
    on conflict (target_id, swiper_id)
      do update set action_code = excluded.action_code, created_at = excluded.created_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_pending_likes on public.swipes;
create trigger trg_sync_pending_likes
  after insert on public.swipes
  for each row execute function public.sync_pending_likes();

-- ── Trigger sur blocks : un bloqué ne reste pas dans les pending (deux sens) ──
create or replace function public.purge_pending_on_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.pending_likes
   where (target_id = new.blocker_id and swiper_id = new.blocked_id)
      or (target_id = new.blocked_id and swiper_id = new.blocker_id);
  return new;
end $$;

drop trigger if exists trg_purge_pending_on_block on public.blocks;
create trigger trg_purge_pending_on_block
  after insert on public.blocks
  for each row execute function public.purge_pending_on_block();

-- ── Backfill : rattrape l'existant (like reçu, non répondu, non bloqué) ───────
insert into public.pending_likes (target_id, swiper_id, action_code, created_at)
select s.target_id, s.swiper_id, a.code, s.created_at
from public.swipes s
join public.swipe_actions a on a.id = s.action_id
where a.code in ('like', 'super_like')
  and not exists (select 1 from public.swipes r
                  where r.swiper_id = s.target_id and r.target_id = s.swiper_id)
  and not exists (select 1 from public.blocks b
                  where (b.blocker_id = s.target_id and b.blocked_id = s.swiper_id)
                     or (b.blocker_id = s.swiper_id and b.blocked_id = s.target_id))
on conflict (target_id, swiper_id) do nothing;

alter table public.pending_likes enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).
