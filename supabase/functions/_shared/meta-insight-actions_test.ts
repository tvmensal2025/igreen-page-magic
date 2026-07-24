import {
  pickMetaActionValue,
  pickMetaConversations,
  pickMetaLeads,
  META_CONV_ACTION_PRIORITY,
} from "./meta-insight-actions.ts";

Deno.test("pickMetaConversations usa só conversation_started (não soma first_reply/total)", () => {
  const actions = [
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "14" },
    { action_type: "onsite_conversion.messaging_first_reply", value: "12" },
    { action_type: "onsite_conversion.total_messaging_connection", value: "14" },
  ];
  const conv = pickMetaConversations(actions);
  if (conv !== 14) throw new Error(`esperado 14, veio ${conv} (soma seria 40)`);
});

Deno.test("pickMetaConversations cai no fallback se started ausente", () => {
  const actions = [
    { action_type: "onsite_conversion.messaging_first_reply", value: "9" },
    { action_type: "onsite_conversion.total_messaging_connection", value: "11" },
  ];
  const conv = pickMetaConversations(actions);
  if (conv !== 9) throw new Error(`esperado first_reply=9, veio ${conv}`);
});

Deno.test("pickMetaLeads não soma lead + lead_grouped", () => {
  const actions = [
    { action_type: "lead", value: "5" },
    { action_type: "onsite_conversion.lead_grouped", value: "5" },
  ];
  const leads = pickMetaLeads(actions);
  if (leads !== 5) throw new Error(`esperado 5, veio ${leads}`);
});

Deno.test("pickMetaActionValue retorna 0 sem actions", () => {
  if (pickMetaActionValue(undefined, META_CONV_ACTION_PRIORITY) !== 0) {
    throw new Error("undefined deve ser 0");
  }
  if (pickMetaActionValue([], META_CONV_ACTION_PRIORITY) !== 0) {
    throw new Error("[] deve ser 0");
  }
});
