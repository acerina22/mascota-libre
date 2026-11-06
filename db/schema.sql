-- Mascota Libre — esquema para Neon (Postgres + Data API + Neon Auth)
-- Los usuarios viven en neon_auth; auth.user_id() devuelve el id del usuario logueado.

create table if not exists public.profiles (
  id              text primary key default auth.user_id(),
  display_name    text not null default '' check (char_length(display_name) <= 80),
  phone           text not null default '' check (char_length(phone) <= 30),
  city            text not null default '' check (char_length(city) <= 80),
  bio             text not null default '' check (char_length(bio) <= 600),
  is_shelter      boolean not null default false,
  shelter_name    text not null default '' check (char_length(shelter_name) <= 100),
  is_foster       boolean not null default false,
  foster_species  text not null default 'ambos' check (foster_species in ('perro','gato','ambos')),
  foster_capacity int not null default 1 check (foster_capacity between 1 and 50),
  foster_notes    text not null default '' check (char_length(foster_notes) <= 400),
  created_at      timestamptz not null default now()
);

create table if not exists public.pets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id() references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  species     text not null check (species in ('perro','gato')),
  sex         text not null check (sex in ('macho','hembra')),
  age_value   int  not null check (age_value between 0 and 30),
  age_unit    text not null check (age_unit in ('meses','años')),
  size        text not null default 'mediano' check (size in ('chico','mediano','grande')),
  breed       text not null default 'Mestizo' check (char_length(breed) <= 60),
  city        text not null check (char_length(city) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  neutered    boolean not null default false,
  vaccinated  boolean not null default false,
  dewormed    boolean not null default false,
  photo_url   text not null default '',  -- sin uso
  photo_thumb text not null default '' check (photo_thumb = '' or (photo_thumb like 'data:image/jpeg;base64,%' and char_length(photo_thumb) <= 80000)),
  status      text not null default 'disponible' check (status in ('disponible','en_proceso','adoptado')),
  created_at  timestamptz not null default now()
);
create index if not exists pets_status_created_idx on public.pets (status, created_at desc);
create index if not exists pets_owner_idx on public.pets (owner_id);

create table if not exists public.adoption_requests (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  adopter_id  text not null default auth.user_id() references public.profiles(id) on delete cascade,
  message     text not null check (char_length(message) between 1 and 1000),
  contact     text not null check (char_length(contact) between 6 and 60),
  status      text not null default 'pendiente' check (status in ('pendiente','aceptada','rechazada')),
  created_at  timestamptz not null default now(),
  unique (pet_id, adopter_id)
);
create index if not exists adoption_requests_pet_idx on public.adoption_requests (pet_id);
create index if not exists adoption_requests_adopter_idx on public.adoption_requests (adopter_id);

-- Quien publica solo puede cambiar el estado de una solicitud
create or replace function public.lock_request_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.pet_id <> old.pet_id or new.adopter_id <> old.adopter_id
     or new.message <> old.message or new.contact <> old.contact then
    raise exception 'Solo se puede cambiar el estado de la solicitud';
  end if;
  return new;
end $$;
drop trigger if exists lock_request_fields on public.adoption_requests;
create trigger lock_request_fields before update on public.adoption_requests
  for each row execute function public.lock_request_fields();

-- Permisos: visitantes sin cuenta leen mascotas y perfiles; usuarios registrados escriben
grant usage on schema public to anonymous;
grant select on public.pets, public.profiles to anonymous;
revoke all on public.adoption_requests from anonymous;

alter table public.profiles enable row level security;
alter table public.pets enable row level security;
alter table public.adoption_requests enable row level security;

-- Perfiles
create policy profiles_read on public.profiles for select to anonymous, authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.user_id()) = id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.user_id()) = id) with check ((select auth.user_id()) = id);

-- Mascotas
create policy pets_read on public.pets for select to anonymous, authenticated using (true);
create policy pets_insert on public.pets for insert to authenticated with check ((select auth.user_id()) = owner_id);
create policy pets_update on public.pets for update to authenticated
  using ((select auth.user_id()) = owner_id) with check ((select auth.user_id()) = owner_id);
create policy pets_delete on public.pets for delete to authenticated using ((select auth.user_id()) = owner_id);

-- Solicitudes: las ve quien adopta y quien publicó
create policy req_read on public.adoption_requests for select to authenticated
  using ((select auth.user_id()) = adopter_id
      or exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())));
create policy req_insert on public.adoption_requests for insert to authenticated
  with check ((select auth.user_id()) = adopter_id and status = 'pendiente'
      and exists (select 1 from public.pets p where p.id = pet_id and p.owner_id <> (select auth.user_id()) and p.status <> 'adoptado'));
create policy req_update on public.adoption_requests for update to authenticated
  using (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())))
  with check (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())));
create policy req_delete on public.adoption_requests for delete to authenticated
  using ((select auth.user_id()) = adopter_id);

-- Fotos grandes (una por mascota)
create table if not exists public.pet_photos (
  pet_id     uuid primary key references public.pets(id) on delete cascade,
  data       text not null check (data like 'data:image/jpeg;base64,%' and char_length(data) <= 450000),
  updated_at timestamptz not null default now()
);
grant select on public.pet_photos to anonymous;
grant select, insert, update, delete on public.pet_photos to authenticated;
alter table public.pet_photos enable row level security;
create policy photos_read on public.pet_photos for select to anonymous, authenticated using (true);
create policy photos_insert on public.pet_photos for insert to authenticated
  with check (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())));
create policy photos_update on public.pet_photos for update to authenticated
  using (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())))
  with check (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())));
create policy photos_delete on public.pet_photos for delete to authenticated
  using (exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.user_id())));

-- ─────────── Perdidos y encontrados, rescatistas, ficha de adoptante, seguimiento y calificaciones ───────────
-- (aplicado en Neon; resumen)
-- lost_found / lost_found_photos: avisos "se perdió" / "encontrado", lectura pública, cada uno edita lo suyo.
-- profiles.is_rescuer: rol de rescatista.
-- adopter_profiles: ficha de adoptante responsable (los 4 compromisos obligatorios). La ve la propia persona
--   y quien publicó una mascota a la que esa persona le pidió adoptar.
-- adoption_followups: novedades post-adopción de una solicitud aceptada; las ven y escriben adoptante y quien publicó.
-- user_ratings + vista rating_summary: 1 a 5 estrellas, solo entre las dos partes de una solicitud aceptada,
--   una calificación por persona por adopción. Lectura pública.
