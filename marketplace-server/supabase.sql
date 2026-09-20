-- AxiomCode Marketplace - Supabase schema
create extension if not exists pgcrypto;

create table if not exists public.marketplace_extensions (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$'),
  name text not null check (char_length(name) <= 120),
  version text not null check (char_length(version) <= 40),
  description text not null default '',
  publisher text not null default 'Comunidad',
  verified boolean not null default false,
  featured boolean not null default false,
  reserved boolean not null default false,
  status text not null default 'published' check (status in ('published','hidden','blocked')),
  tags jsonb not null default '[]'::jsonb,
  homepage text,
  source_repo text,
  source_commit text,
  icon text,
  install jsonb not null,
  downloads bigint not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketplace_extensions_source_repo_key
  on public.marketplace_extensions (lower(source_repo))
  where source_repo is not null;

create table if not exists public.marketplace_publications (
  id uuid primary key default gen_random_uuid(),
  extension_id text not null,
  repo_url text not null,
  version text not null,
  commit_sha text not null,
  ip_hash text,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create index if not exists marketplace_publications_extension_idx
  on public.marketplace_publications(extension_id, created_at desc);

alter table public.marketplace_extensions enable row level security;
alter table public.marketplace_publications enable row level security;

-- No anon write/read policy is required: the Render API uses the service-role key.
-- Seed the bundled Scratch extension so it appears before community extensions.
insert into public.marketplace_extensions
(id,name,version,description,publisher,verified,featured,reserved,status,tags,homepage,source_repo,source_commit,icon,install)
values
('axiom.scratch-mode','Modo Scratch','2.2.0',
 'Scratch 3 oficial integrado con proyectos .sb3 y Axiom 3D WebGL.',
 'AxiomCode',true,true,true,'published',
 '["scratch","bloques","3d","educacion"]'::jsonb,
 'https://github.com/Tylerpro09/AxiomCode',null,null,null,
 '{"kind":"bundled","bundledId":"axiom.scratch-mode"}'::jsonb)
on conflict (id) do update set
 name=excluded.name,version=excluded.version,description=excluded.description,
 publisher=excluded.publisher,verified=true,featured=true,reserved=true,
 status='published',tags=excluded.tags,homepage=excluded.homepage,install=excluded.install,
 updated_at=now();