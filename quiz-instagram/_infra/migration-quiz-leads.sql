-- Migração aplicada no Supabase do NEXUS (wrxgpfsjupgbtowuspth) em 2026-08-04.
-- Nomes no banco: create_quiz_leads + grant_quiz_leads_view_service_role.
-- Guardado aqui porque o MCP apply_migration carimba a versão no banco e não
-- deixa arquivo no repo — sem esta cópia, o DDL some do histórico do projeto.

create table if not exists v2.quiz_leads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'meio',
  quiz_slug text not null default 'instagram',
  session_token uuid not null unique,
  nome text not null,
  whatsapp text not null,
  whatsapp_raw text,
  email text not null,
  nicho text,
  respostas jsonb not null default '{}'::jsonb,
  score_a smallint not null default 0,
  score_b smallint not null default 0,
  score_c smallint not null default 0,
  perfil text,
  status text not null default 'iniciado',
  ultima_tela smallint not null default 1,
  concluido_em timestamptz,
  consentimento_lgpd boolean not null default false,
  consentido_em timestamptz,
  clicou_whatsapp boolean not null default false,
  clicou_whatsapp_em timestamptz,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referrer text, user_agent text, ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_leads_perfil_chk check (perfil is null or perfil in ('timida','sem_constancia','perdida')),
  constraint quiz_leads_status_chk check (status in ('iniciado','em_andamento','concluido')),
  constraint quiz_leads_email_chk check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint quiz_leads_whatsapp_chk check (whatsapp ~ '^55[1-9][0-9]{9,10}$')
);

create index if not exists quiz_leads_created_idx  on v2.quiz_leads (created_at desc);
create index if not exists quiz_leads_perfil_idx   on v2.quiz_leads (perfil) where perfil is not null;
create index if not exists quiz_leads_status_idx   on v2.quiz_leads (status);
create index if not exists quiz_leads_whatsapp_idx on v2.quiz_leads (whatsapp);
create index if not exists quiz_leads_tenant_idx   on v2.quiz_leads (tenant, created_at desc);

create or replace function v2.quiz_leads_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists quiz_leads_touch_trg on v2.quiz_leads;
create trigger quiz_leads_touch_trg before update on v2.quiz_leads
  for each row execute function v2.quiz_leads_touch();

alter table v2.quiz_leads enable row level security;

drop policy if exists quiz_leads_select on v2.quiz_leads;
create policy quiz_leads_select on v2.quiz_leads for select to authenticated
  using (tenant = v2.current_tenant());

drop policy if exists quiz_leads_update on v2.quiz_leads;
create policy quiz_leads_update on v2.quiz_leads for update to authenticated
  using (tenant = v2.current_tenant() and v2.current_role_v2() = any (array['admin_master','admin']));

drop policy if exists quiz_leads_delete on v2.quiz_leads;
create policy quiz_leads_delete on v2.quiz_leads for delete to authenticated
  using (tenant = v2.current_tenant() and v2.current_role_v2() = any (array['admin_master','admin']));

grant select, update, delete on v2.quiz_leads to authenticated;
grant select, insert, update, delete on v2.quiz_leads to service_role;

drop view if exists public.v2_quiz_leads;
create view public.v2_quiz_leads with (security_invoker = on) as select * from v2.quiz_leads;

grant select, update, delete on public.v2_quiz_leads to authenticated;
grant select, insert, update on public.v2_quiz_leads to service_role;
