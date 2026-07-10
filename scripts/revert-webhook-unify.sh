#!/usr/bin/env bash
#
# REVERSÃO COMPLETA da unificação dos webhooks (Etapas 1 + 2 + 3a).
# Para reverter só Etapa 2: scripts/revert-webhook-unify-stage2.sh
# Para reverter só Etapa 3a: scripts/revert-webhook-unify-stage3a.sh
# -------------------------------------------------------------------
# Etapa 1 — state-machine + step-namespace:
#   _shared/bot/conversational-state-machine.ts, step-namespace.ts
# Etapa 2 — intent-classifier + types:
#   _shared/bot/intent-classifier.ts, handler-types.ts
# Etapa 3a — conversational templates:
#   _shared/bot/conversational-templates.ts
#
# Este script restaura os 10 arquivos shim ao conteúdo original do git HEAD
# e remove a fonte única — voltando ao estado anterior à unificação.
#
# Premissa: as mudanças AINDA NÃO foram commitadas (caso padrão). Se já
# tiverem sido commitadas, use `git revert <commit>` em vez deste script.
#
# Uso:  bash scripts/revert-webhook-unify.sh
# -------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(
  "supabase/functions/whapi-webhook/handlers/conversational/state-machine.ts"
  "supabase/functions/evolution-webhook/handlers/conversational/state-machine.ts"
  "supabase/functions/whapi-webhook/handlers/step-namespace.ts"
  "supabase/functions/evolution-webhook/handlers/step-namespace.ts"
  "supabase/functions/whapi-webhook/handlers/types.ts"
  "supabase/functions/evolution-webhook/handlers/types.ts"
  "supabase/functions/whapi-webhook/handlers/conversational/intent-classifier.ts"
  "supabase/functions/evolution-webhook/handlers/conversational/intent-classifier.ts"
  "supabase/functions/whapi-webhook/handlers/conversational/templates.ts"
  "supabase/functions/evolution-webhook/handlers/conversational/templates.ts"
)

echo "1/3 — Restaurando os 10 arquivos dos webhooks ao estado do git HEAD..."
git checkout HEAD -- "${FILES[@]}"

echo "2/3 — Removendo fontes únicas em _shared/bot/..."
rm -f \
  "supabase/functions/_shared/bot/conversational-state-machine.ts" \
  "supabase/functions/_shared/bot/step-namespace.ts" \
  "supabase/functions/_shared/bot/handler-types.ts" \
  "supabase/functions/_shared/bot/intent-classifier.ts" \
  "supabase/functions/_shared/bot/conversational-templates.ts"

echo "3/3 — Validando com deno check..."
( cd supabase/functions && deno check whapi-webhook/index.ts evolution-webhook/index.ts )

echo ""
echo "Reversão concluída. Para publicar a reversão em produção, rode:"
echo "  supabase functions deploy whapi-webhook   --project-ref zlzasfhcxcznaprrragl"
echo "  supabase functions deploy evolution-webhook --project-ref zlzasfhcxcznaprrragl"
