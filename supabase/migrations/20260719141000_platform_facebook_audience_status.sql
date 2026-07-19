-- View sem token: consultores leem status da audience sem ver access_token.
drop view if exists public.platform_facebook_audience_status;

create view public.platform_facebook_audience_status
with (security_invoker = false) as
select
  id,
  custom_audience_id,
  audience_synced_at,
  audience_source_count,
  retarget_ddd_allowlist,
  updated_at
from public.platform_facebook_account;

grant select on public.platform_facebook_audience_status to authenticated;

comment on view public.platform_facebook_audience_status is
  'Status da Custom Audience da plataforma (sem token). Usado no painel Ads.';
