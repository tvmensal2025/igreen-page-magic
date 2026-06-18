#!/usr/bin/env bash
#
# REVERSÃO APENAS da Etapa 2 (intent-classifier + types).
# Etapa 1 (state-machine + step-namespace) permanece unificada.
#
# Uso:  bash scripts/revert-webhook-unify-stage2.sh
# -------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  "supabase/functions/whapi-webhook/handlers/types.ts"
  "supabase/functions/evolution-webhook/handlers/types.ts"
  "supabase/functions/whapi-webhook/handlers/conversational/intent-classifier.ts"
  "supabase/functions/evolution-webhook/handlers/conversational/intent-classifier.ts"
)

echo "1/3 — Restaurando os 4 arquivos da Etapa 2 ao estado do git HEAD..."
git checkout HEAD -- "${FILES[@]}"

echo "2/3 — Removendo fonte única Etapa 2 em _shared/bot/..."
rm -f \
  "supabase/functions/_shared/bot/handler-types.ts" \
  "supabase/functions/_shared/bot/intent-classifier.ts"

echo "3/3 — Validando com deno check..."
( cd supabase/functions && deno check whapi-webhook/index.ts evolution-webhook/index.ts )

echo ""
echo "Reversão Etapa 2 concluída. Etapa 1 (state-machine, step-namespace) intacta."
echo "Para publicar: supabase functions deploy whapi-webhook evolution-webhook --project-ref zlzasfhcxcznaprrragl"
