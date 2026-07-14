#!/usr/bin/env bash
# Grava secrets Velip nas Edge Functions + imprime URL de callback para o painel.
# Uso:
#   export SUPABASE_ACCESS_TOKEN=sbp_...
#   export VELIP_API_TOKEN='token-do-painel'
#   ./scripts/setup-velip-secrets.sh
#
# Opcional: VELIP_CALLER_ID=55DDNNNNNNNN  VELIP_WEBHOOK_AUTH=<hex>  VOICE_DIALER_CRON_SECRET=<hex>
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-zlzasfhcxcznaprrragl}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Defina SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens)" >&2
  exit 1
fi
if [[ -z "${VELIP_API_TOKEN:-}" ]]; then
  echo "Defina VELIP_API_TOKEN (painel Velip → Integrações → API)" >&2
  exit 1
fi

export VELIP_WEBHOOK_AUTH="${VELIP_WEBHOOK_AUTH:-$(openssl rand -hex 32)}"
export VOICE_DIALER_CRON_SECRET="${VOICE_DIALER_CRON_SECRET:-}"
export VELIP_CALLER_ID="${VELIP_CALLER_ID:-}"
export PROJECT_REF

if [[ -z "${VOICE_DIALER_CRON_SECRET}" ]]; then
  # Preferir valor já usado pelo pg_cron em public.settings
  if command -v supabase >/dev/null 2>&1; then
    VOICE_DIALER_CRON_SECRET="$(
      supabase db query --linked \
        "SELECT value FROM public.settings WHERE key='voice_dialer_cron_secret';" \
        -o json 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); rows=d.get('rows') or d; print((rows[0] or {}).get('value','') if rows else '')" \
        2>/dev/null || true
    )"
    export VOICE_DIALER_CRON_SECRET
  fi
fi
if [[ -z "${VOICE_DIALER_CRON_SECRET}" ]]; then
  export VOICE_DIALER_CRON_SECRET="$(openssl rand -hex 32)"
  echo "AVISO: gerou VOICE_DIALER_CRON_SECRET novo — sincronize public.settings.voice_dialer_cron_secret" >&2
fi

PAYLOAD="$(python3 - <<'PY'
import json, os
items = [
  {"name": "VELIP_API_TOKEN", "value": os.environ["VELIP_API_TOKEN"].strip()},
  {"name": "VELIP_WEBHOOK_AUTH", "value": os.environ["VELIP_WEBHOOK_AUTH"].strip()},
  {"name": "VOICE_DIALER_CRON_SECRET", "value": os.environ["VOICE_DIALER_CRON_SECRET"].strip()},
]
caller = os.environ.get("VELIP_CALLER_ID", "").strip()
if caller:
  items.append({"name": "VELIP_CALLER_ID", "value": caller})
print(json.dumps(items))
PY
)"

HTTP="$(curl -sS -o /tmp/velip_secrets_set.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

if [[ "$HTTP" != "201" && "$HTTP" != "200" ]]; then
  echo "Falha ao gravar secrets (HTTP $HTTP):" >&2
  cat /tmp/velip_secrets_set.json >&2
  exit 1
fi

URL="https://${PROJECT_REF}.supabase.co/functions/v1/voice-dialer-webhook?auth=${VELIP_WEBHOOK_AUTH}"
echo "OK — secrets gravados."
echo
echo "Cole esta URL no painel Velip → Integrações → URLs para Retorno:"
echo "$URL"
echo
echo "Validar: Admin → Ligação (banner Velip) ou POST voice-dialer-health"
