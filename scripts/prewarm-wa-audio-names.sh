#!/usr/bin/env bash
# Pré-aquece áudios Sofia (A2/A3) para nomes comuns + plataforma.
# Uso:
#   export SUPABASE_ACCESS_TOKEN=sbp_...
#   export SUPABASE_SERVICE_ROLE_KEY=...   # ou já no ambiente linked
#   ./scripts/prewarm-wa-audio-names.sh
#
# Env opcionais:
#   CONSULTANT_ID  (default Rafael)
#   LIMIT          (default 15 por lote)
#   MAX_BATCHES    (default 40)
#   DRY_RUN=1

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-zlzasfhcxcznaprrragl}"
CONSULTANT_ID="${CONSULTANT_ID:-0c2711ad-4836-41e6-afba-edd94f698ae3}"
LIMIT="${LIMIT:-15}"
MAX_BATCHES="${MAX_BATCHES:-40}"
DRY_RUN="${DRY_RUN:-0}"
URL="https://${PROJECT_REF}.supabase.co/functions/v1/wa-audio-prewarm"

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Defina SUPABASE_SERVICE_ROLE_KEY (service role do projeto)."
  exit 1
fi

offset=0
batch=0
echo "prewarm consultant=$CONSULTANT_ID limit=$LIMIT dry_run=$DRY_RUN"

while (( batch < MAX_BATCHES )); do
  batch=$((batch + 1))
  body=$(jq -n \
    --arg cid "$CONSULTANT_ID" \
    --argjson lim "$LIMIT" \
    --argjson off "$offset" \
    --argjson dry "$([[ "$DRY_RUN" == "1" ]] && echo true || echo false)" \
    '{consultant_id:$cid, limit:$lim, offset:$off, dry_run:$dry, include_common:true, include_platform:true, slots:["a2_audio_activate_name","a3_explain_with_buttons"]}')

  echo "── lote $batch offset=$offset ──"
  resp=$(curl -sS -X POST "$URL" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")

  echo "$resp" | jq '{ok, total_names, offset, processed_names, generated, cache_hits, failed, has_more, next_offset, sample: (.sample // .results[:3])}'

  has_more=$(echo "$resp" | jq -r '.has_more // false')
  next=$(echo "$resp" | jq -r '.next_offset // empty')
  if [[ "$has_more" != "true" || -z "$next" ]]; then
    echo "Concluído."
    break
  fi
  offset="$next"
  sleep 2
done
