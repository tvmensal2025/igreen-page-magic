#!/usr/bin/env bash
#
# REVERSÃO APENAS da Etapa 3a (conversational templates).
# Etapas 1–2 permanecem unificadas.
#
# Uso:  bash scripts/revert-webhook-unify-stage3a.sh
# -------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  "supabase/functions/whapi-webhook/handlers/conversational/templates.ts"
  "supabase/functions/evolution-webhook/handlers/conversational/templates.ts"
)

echo "1/3 — Restaurando templates ao estado do git HEAD..."
git checkout HEAD -- "${FILES[@]}"

echo "2/3 — Removendo fonte única Etapa 3a..."
rm -f "supabase/functions/_shared/bot/conversational-templates.ts"

echo "3/3 — Validando com deno check..."
( cd supabase/functions && deno check whapi-webhook/index.ts evolution-webhook/index.ts )

echo ""
echo "Reversão Etapa 3a concluída."
