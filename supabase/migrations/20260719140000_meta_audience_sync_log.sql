-- Log de uploads para Custom Audience Meta (remarketing / retarget).
create table if not exists public.meta_audience_sync_log (
  id uuid primary key default gen_random_uuid(),
  audience_id text,
  customer_id uuid references public.customers(id) on delete set null,
  consultant_id uuid,
  source text not null default 'sync',
  ok boolean not null default true,
  detail text,
  phone_ddd text,
  created_at timestamptz not null default now()
);

create index if not exists meta_audience_sync_log_created_at_idx
  on public.meta_audience_sync_log (created_at desc);
create index if not exists meta_audience_sync_log_consultant_day_idx
  on public.meta_audience_sync_log (consultant_id, created_at desc);

alter table public.platform_facebook_account
  add column if not exists retarget_ddd_allowlist integer[] default array[34];

comment on column public.platform_facebook_account.retarget_ddd_allowlist is
  'DDDs permitidos no sync de remarketing (ex.: {34} Uberlândia). Vazio = todos.';

alter table public.meta_audience_sync_log enable row level security;

drop policy if exists meta_audience_sync_log_select_own on public.meta_audience_sync_log;
create policy meta_audience_sync_log_select_own
  on public.meta_audience_sync_log for select
  to authenticated
  using (
    consultant_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('admin', 'super_admin')
    )
  );
