/**
 * Áudio FAQ Sofia: poucos padrões completos (não 10 quase iguais).
 * Gatilhos continuam separados; texto/áudio compartilham o mesmo slot.
 */

export type FaqPadraoKey = "confianca" | "preco" | "cancelamento" | "tecnico" | "cadastro";

export const FAQ_AUDIO_PADROES: ReadonlyArray<{
  key: FaqPadraoKey;
  label: string;
  /** Intent “canônico” usado pra gerar o MP3 uma vez */
  canonicalIntent: string;
  /** Intents que reutilizam o mesmo áudio/texto */
  intents: readonly string[];
}> = [
  {
    key: "confianca",
    label: "Padrão Confiança (legal / golpe / CNPJ)",
    canonicalIntent: "Confiança · É golpe / furada",
    intents: [
      "Confiança · É golpe / furada",
      "Confiança · Não confio nessa empresa",
      "Confiança · Nunca ouvi falar",
      "Confiança · CNPJ / regulamentação",
      "Confiança · Há quanto tempo existe",
    ],
  },
  {
    key: "preco",
    label: "Padrão Preço (adesão / taxa / desconto)",
    canonicalIntent: "Preço · Tem taxa escondida",
    intents: [
      "Preço · Tem taxa escondida",
      "Preço · Pagar pra entrar",
      "Preço · Desconto é falso",
      "Preço · É caro / não tenho dinheiro",
      "Preço · Vou pagar a mais no fim",
    ],
  },
  {
    key: "cancelamento",
    label: "Padrão Cancelamento (fidelidade / como cancelar)",
    canonicalIntent: "Cancelamento · Fidelidade / multa",
    intents: [
      "Cancelamento · Fidelidade / multa",
      "Cancelamento · Como faço pra cancelar",
      "Cancelamento · Posso cancelar quando quiser",
      "Cancelamento · É difícil cancelar",
    ],
  },
  {
    key: "tecnico",
    label: "Padrão Técnico (troca / apto / sem obra)",
    canonicalIntent: "Técnico · Trocar de empresa",
    intents: [
      "Técnico · Trocar de empresa",
      "Técnico · Funciona pra apartamento",
      "Técnico · Mexer na fiação",
      "Técnico · Placa solar / painel",
    ],
  },
  {
    key: "cadastro",
    label: "Padrão Cadastro (documento / LGPD)",
    canonicalIntent: "Cadastro · Não vou mandar RG/CNH",
    intents: [
      "Cadastro · Não vou mandar RG/CNH",
      "Cadastro · Não vou mandar foto da conta",
      "Cadastro · Por que precisam do CPF",
      "Cadastro · E se vazarem meus dados",
    ],
  },
];

/** Intents canônicos — gerar só estes 5 áudios. */
export const PRIORITY_FAQ_INTENTS: readonly string[] = FAQ_AUDIO_PADROES.map((p) => p.canonicalIntent);

export const QA_AUDIO_APPROVED_TAG = "qa_approved";

const INTENT_TO_PADRAO = new Map<string, FaqPadraoKey>();
for (const p of FAQ_AUDIO_PADROES) {
  for (const intent of p.intents) INTENT_TO_PADRAO.set(intent, p.key);
}

export function faqPadraoKeyForIntent(intentName: string): FaqPadraoKey | null {
  return INTENT_TO_PADRAO.get(intentName) ?? null;
}

export function intentToSharedBodySlot(intentName: string): string {
  const key = faqPadraoKeyForIntent(intentName);
  if (key) return `qa_body:padrao_${key}`;
  const slug = String(intentName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `qa_body:${slug}`;
}

export function isPriorityFaqIntent(intentName: string): boolean {
  return INTENT_TO_PADRAO.has(intentName);
}

export function priorityFaqRank(intentName: string): number {
  const key = faqPadraoKeyForIntent(intentName);
  if (!key) return 999;
  return FAQ_AUDIO_PADROES.findIndex((p) => p.key === key);
}
