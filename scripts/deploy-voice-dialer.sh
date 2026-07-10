#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Defina SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens) ou rode: supabase login"
  exit 1
fi
supabase functions deploy voice-dialer-enqueue --project-ref zlzasfhcxcznaprrragl
supabase functions deploy voice-dialer-cron --project-ref zlzasfhcxcznaprrragl --no-verify-jwt
supabase functions deploy voice-dialer-webhook --project-ref zlzasfhcxcznaprrragl --no-verify-jwt
echo "OK — agora configure os secrets Twilio (ver mem/features/voice-dialer.md)"
