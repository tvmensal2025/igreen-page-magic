DELETE FROM public.storage_migration_log
WHERE source_bucket = 'whatsapp-media'
  AND source_path LIKE 'captacao/75572275-4c30-475d-9717-b52b031a59ed/%';

DELETE FROM public.storage_migration_log
WHERE status = 'in_progress'
  AND source_bucket = 'consultant-photos'
  AND source_path = '0c2711ad-4836-41e6-afba-edd94f698ae3/ads/video-uberaba-reels-clean-1784766569.mp4';