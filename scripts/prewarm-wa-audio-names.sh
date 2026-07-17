#!/usr/bin/env bash
# Pré-aquece áudios Sofia (A2/A3) — stitch completo por nome.
# mode=full gera:
#   stitch:a2_audio_activate_name:ola3:{genero}:{nome}
#   stitch:a3_explain_with_buttons:n3:x:{nome}
# (reusa intro:nome / intro:ola / corpos __body_* se já existirem)
#
# Uso:
#   export SUPABASE_SERVICE_ROLE_KEY=...
#   ./scripts/prewarm-wa-audio-names.sh
#   DRY_RUN=1 ./scripts/prewarm-wa-audio-names.sh
#
# Env opcionais:
#   CONSULTANT_ID     (default Rafael)
#   LIMIT             (default 10 por lote — full faz 2 slots/nome)
#   MAX_BATCHES       (default 25 → ~250 nomes)
#   MODE              (default ola_only | full | nome_only)
#                     ola_only = “Olá, Nome.” (A2) · nome_only = só nome (A3)
#   INCLUDE_PLATFORM  (default 0 — só nomes comuns BR; 1 = + CRM)
#   DRY_RUN=1

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-zlzasfhcxcznaprrragl}"
CONSULTANT_ID="${CONSULTANT_ID:-0c2711ad-4836-41e6-afba-edd94f698ae3}"
LIMIT="${LIMIT:-10}"
MAX_BATCHES="${MAX_BATCHES:-25}"
MODE="${MODE:-ola_only}"
INCLUDE_PLATFORM="${INCLUDE_PLATFORM:-0}"
DRY_RUN="${DRY_RUN:-0}"
START_OFFSET="${START_OFFSET:-0}"
URL="https://${PROJECT_REF}.supabase.co/functions/v1/wa-audio-prewarm"

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Defina SUPABASE_SERVICE_ROLE_KEY (service role do projeto)."
  exit 1
fi

offset="$START_OFFSET"
batch=0
echo "prewarm consultant=$CONSULTANT_ID mode=$MODE limit=$LIMIT platform=$INCLUDE_PLATFORM dry_run=$DRY_RUN start_offset=$START_OFFSET"

while (( batch < MAX_BATCHES )); do
  batch=$((batch + 1))
  body=$(LIMIT="$LIMIT" OFFSET="$offset" DRY_RUN="$DRY_RUN" MODE="$MODE" \
    INCLUDE_PLATFORM="$INCLUDE_PLATFORM" CONSULTANT_ID="$CONSULTANT_ID" python3 - <<'PY'
import json, os
print(json.dumps({
  "consultant_id": os.environ["CONSULTANT_ID"],
  "mode": os.environ["MODE"],
  "limit": int(os.environ["LIMIT"]),
  "offset": int(os.environ["OFFSET"]),
  "dry_run": os.environ["DRY_RUN"] == "1",
  "include_common": True,
  "include_platform": os.environ["INCLUDE_PLATFORM"] == "1",
  "slots": ["a2_audio_activate_name", "a3_explain_with_buttons"],
}))
PY
)

  echo "── lote $batch offset=$offset ──"
  resp=$(curl -sS -X POST "$URL" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")

  RESP_JSON="$resp" python3 - <<'PY'
import json, os
raw = os.environ.get("RESP_JSON", "")
try:
  d = json.loads(raw)
except Exception:
  print(raw[:500])
  raise SystemExit(1)
keys = ["ok", "mode", "total_names", "offset", "processed_names", "generated", "cache_hits", "failed", "has_more", "next_offset"]
out = {k: d.get(k) for k in keys}
out["sample"] = d.get("sample") or (d.get("results") or [])[:3]
print(json.dumps(out, ensure_ascii=False, indent=2))
PY

  has_more=$(RESP_JSON="$resp" python3 -c 'import json,os; print(json.loads(os.environ["RESP_JSON"]).get("has_more", False))')
  next=$(RESP_JSON="$resp" python3 -c 'import json,os; v=json.loads(os.environ["RESP_JSON"]).get("next_offset"); print("" if v is None else v)')
  if [[ "$has_more" != "True" || -z "$next" ]]; then
    echo "Concluído."
    break
  fi
  offset="$next"
  sleep 2
done
