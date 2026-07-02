
do $$ begin perform cron.unschedule('fb-sync-metrics'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('fb-sync-ad-creatives'); exception when others then null; end $$;

alter table public.facebook_campaigns
  add column if not exists thumbnail_url text,
  add column if not exists creative_format text,
  add column if not exists thumbnail_synced_at timestamptz;
