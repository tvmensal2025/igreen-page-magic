#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Defina SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens) ou rode: supabase login"
  exit 1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-zlzasfhcxcznaprrragl}"

supabase functions deploy voice-dialer-enqueue --project-ref "$PROJECT_REF"
supabase functions deploy voice-dialer-cron --project-ref "$PROJECT_REF" --no-verify-jwt
supabase functions deploy voice-dialer-webhook --project-ref "$PROJECT_REF" --no-verify-jwt
supabase functions deploy voice-dialer-health --project-ref "$PROJECT_REF" --no-verify-jwt
supabase functions deploy voice-campaign-control --project-ref "$PROJECT_REF"
supabase functions deploy voice-sms-send --project-ref "$PROJECT_REF"
supabase functions deploy voice-contact-base --project-ref "$PROJECT_REF"
supabase functions deploy voice-dashboard-metrics --project-ref "$PROJECT_REF"
supabase functions deploy voice-template-stitch --project-ref "$PROJECT_REF"

echo "OK — configure secrets Velip (não Twilio):"
echo "  VELIP_API_TOKEN, VELIP_WEBHOOK_AUTH, VELIP_CALLER_ID (opcional),"
echo "  VOICE_DIALER_CRON_SECRET (+ public.settings.voice_dialer_cron_secret)"
echo "Ver: mem/features/voice-dialer.md"
