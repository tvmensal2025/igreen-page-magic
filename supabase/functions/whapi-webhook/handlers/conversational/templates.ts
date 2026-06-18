// Re-export shim — fonte única em _shared/bot/conversational-templates.ts
// Para reverter só Etapa 3a: bash scripts/revert-webhook-unify-stage3a.sh
export {
  getTemplate,
  renderTemplate,
  type TemplateVars,
} from "../../../_shared/bot/conversational-templates.ts";
