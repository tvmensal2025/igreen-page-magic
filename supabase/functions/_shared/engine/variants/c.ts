/**
 * Variante C — mesma *estratégia de render* da Variante A/D (media_order,
 * botões, synthesize).
 *
 * Conteúdo do fluxo é independente: na UI, C = "Sofia — Ativação Multicanal"
 * (10 passos Grupo A). NÃO confundir com `sync_bot_flow_c_from_a`, que clona
 * passos do Fluxo A e é bloqueado quando C já é Sofia.
 */
export { variantD as variantC } from "./d.ts";
