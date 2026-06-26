-- Captação de leads multicanal (PF e PJ), multi-tenant por consultor.
-- Aditivo: não altera nenhuma tabela existente. RLS espelha o padrão de
-- customers (consultant_id = auth.uid()) + is_super_admin para visão global.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. captured_leads — buffer de captação antes de virar customer/sale
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.captured_leads (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  channel text not null default 'manual'
    check (channel in ('meta_leadads','tiktok_leadgen','ctwa','landing','research','manual')),
  person_type text not null default 'pf'
    check (person_type in ('pf','pj')),

  -- comuns PF/PJ
  full_name text,
  phone text,
  email text,
  city text,
  uf text,
  product_interest text,

  -- só PJ
  company_name text,
  cnpj text,
  pj_data jsonb not null default '{}'::jsonb,

  raw_payload jsonb not null default '{}'::jsonb,

  -- consentimento (LGPD)
  consent_text text,
  consent_at timestamptz,
  consent_source text,

  -- atribuição de origem (reusa campanhas Meta existentes)
  source_campaign_id uuid references public.facebook_campaigns(id) on delete set null,
  ctwa_clid text,

  -- deduplicação
  dedup_key text,

  status text not null default 'new'
    check (status in ('new','enriched','converted','discarded')),

  -- conversão para o funil existente
  customer_id uuid references public.customers(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- dedup por consultor (cada consultor tem a própria base; o mesmo telefone
-- pode existir para consultores diferentes, mas não duplicado para o mesmo)
create unique index if not exists captured_leads_dedup_uidx
  on public.captured_leads (consultant_id, dedup_key)
  where dedup_key is not null;

create index if not exists captured_leads_consultant_created_idx
  on public.captured_leads (consultant_id, created_at desc);
create index if not exists captured_leads_channel_idx
  on public.captured_leads (consultant_id, channel, created_at desc);
create index if not exists captured_leads_person_status_idx
  on public.captured_leads (consultant_id, person_type, status);
create index if not exists captured_leads_phone_idx
  on public.captured_leads (phone) where phone is not null;
create index if not exists captured_leads_cnpj_idx
  on public.captured_leads (cnpj) where cnpj is not null;

comment on table public.captured_leads is
  'Buffer de leads captados (Meta Lead Ads, TikTok, CTWA, landing, pesquisa B2B). Multi-tenant: cada lead pertence ao consultor que o gerou. Vira customer (PF energia) ou sale (PJ/outros) na conversão.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. lead_consent_log — prova de consentimento (LGPD)
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.lead_consent_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.captured_leads(id) on delete cascade,
  consultant_id uuid references public.consultants(id) on delete set null,
  consent_text text not null,
  channel text not null,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists lead_consent_log_lead_idx
  on public.lead_consent_log (lead_id);

comment on table public.lead_consent_log is
  'Evidência imutável de opt-in (LGPD): texto exato do consentimento, canal, IP e user-agent no momento da captação.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger em captured_leads
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.tg_captured_leads_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists captured_leads_touch on public.captured_leads;
create trigger captured_leads_touch
  before update on public.captured_leads
  for each row execute function public.tg_captured_leads_touch();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS — consultor só vê/mexe nos próprios leads; super admin vê tudo
-- ──────────────────────────────────────────────────────────────────────────
alter table public.captured_leads enable row level security;
alter table public.lead_consent_log enable row level security;

-- captured_leads: dono gerencia os seus
create policy "Owner manages own captured leads"
on public.captured_leads for all to authenticated
using (consultant_id = auth.uid())
with check (consultant_id = auth.uid());

-- captured_leads: super admin tem visão global (suporte/auditoria)
create policy "Super admin reads all captured leads"
on public.captured_leads for select to authenticated
using (public.is_super_admin(auth.uid()));

-- lead_consent_log: dono lê os próprios
create policy "Owner reads own consent log"
on public.lead_consent_log for select to authenticated
using (consultant_id = auth.uid());

-- lead_consent_log: super admin lê tudo
create policy "Super admin reads all consent log"
on public.lead_consent_log for select to authenticated
using (public.is_super_admin(auth.uid()));

-- Escrita (insert/update) das duas tabelas acontece via service role nas edge
-- functions, que ignora RLS por padrão. Não criamos policy de insert público.
