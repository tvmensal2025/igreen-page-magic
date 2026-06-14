// =============================================================================
// Orçamento — Barrel export
// =============================================================================
// Ponto de entrada público do submódulo de orçamento/proposta. Agrupa o
// catálogo comercial, o cálculo de valor, types, api (consultor), publicApi
// (destinatário) e hooks. Os componentes de UI são exportados aqui também.
// =============================================================================

export * from "./catalog";
export * from "./pricing";
export * from "./types";
export * from "./api";
export * from "./publicApi";
export * from "./hooks";
export { OrcamentoButton } from "./OrcamentoButton";
export { OrcamentoBuilderSheet } from "./OrcamentoBuilderSheet";
export { ProposalsPanel } from "./ProposalsPanel";
