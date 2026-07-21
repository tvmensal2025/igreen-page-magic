/**
 * Catálogo TTS FAQ: corpos (fecha a dúvida) + closers fixos por passo.
 * PT-BR limpo para ElevenLabs Sofia — sem {{nome}}, markdown, emoji, nem pedido de foto.
 */

export const SOFIA_FLOW_ID = "59f53614-196c-4b6f-a029-59fadca78bd7";
export const SOFIA_CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";
export const SOFIA_VOICE_ID = "EJV7H2baGt5ab95tOoSG";
export const SOFIA_MODEL = "eleven_v3";

/** Closers fixos (1× cada) — casam com qa-step-close.ts, sem pedir foto/mídia. */
export const QA_STEP_CLOSERS: ReadonlyArray<{ stepKey: string; slotKey: string; spoken: string }> = [
  {
    stepKey: "a1_ask_name",
    slotKey: "qa_close:a1_ask_name",
    spoken: "Me diz seu primeiro nome que a gente continua.",
  },
  {
    stepKey: "a2_text_ask_bill_value",
    slotKey: "qa_close:a2_text_ask_bill_value",
    spoken: "Me passa o valor da sua conta de luz que eu calculo sua economia.",
  },
  {
    stepKey: "a3_explain_with_buttons",
    slotKey: "qa_close:a3_explain_with_buttons",
    spoken: "Escolhe uma opção acima ou me diz quero ativar pra seguir.",
  },
  {
    stepKey: "a5b_after_club_buttons",
    slotKey: "qa_close:a5b_after_club_buttons",
    spoken: "Quer ativar? Toca em Cadastrar ou me diz pode seguir.",
  },
  {
    stepKey: "a6_ask_bill_photo",
    slotKey: "qa_close:a6_ask_bill_photo",
    spoken: "Quando quiser continuar a ativação, é só me dizer pode seguir.",
  },
  {
    stepKey: "a7_ask_document",
    slotKey: "qa_close:a7_ask_document",
    spoken: "Pra seguir o cadastro, é só me dizer pode seguir. Eu te guio no próximo passo.",
  },
  {
    stepKey: "a8_ask_email",
    slotKey: "qa_close:a8_ask_email",
    spoken: "Me passa seu e-mail que seguimos com a ativação.",
  },
  {
    stepKey: "a9_confirm_phone",
    slotKey: "qa_close:a9_confirm_phone",
    spoken: "Confirma o telefone nas opções acima ou responde por aqui.",
  },
  {
    stepKey: "a10_portal_otp_facial",
    slotKey: "qa_close:a10_portal_otp_facial",
    spoken: "Digite o código quando receber, ou me diz pode seguir pra retomar.",
  },
  {
    stepKey: "a11_facial_link",
    slotKey: "qa_close:a11_facial_link",
    spoken: "Conclua a validação do passo anterior e me avise por aqui.",
  },
  {
    stepKey: "qualificacao",
    slotKey: "qa_close:qualificacao",
    spoken: "Me passa o valor da conta de luz que eu calculo sua economia.",
  },
  {
    stepKey: "aguardando_conta",
    slotKey: "qa_close:aguardando_conta",
    spoken: "Quando quiser continuar a ativação, é só me dizer pode seguir.",
  },
];

/** 5 padrões únicos — 1 card por padrão (aliases legados só p/ áudio antigo). */
export const FAQ_AUDIO_PADROES: ReadonlyArray<{
  key: string;
  canonicalIntent: string;
  intents: readonly string[];
}> = [
  {
    key: "confianca",
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
    canonicalIntent: "Cadastro · Não vou mandar RG/CNH",
    intents: [
      "Cadastro · Não vou mandar RG/CNH",
      "Cadastro · Não vou mandar foto da conta",
      "Cadastro · Por que precisam do CPF",
      "Cadastro · E se vazarem meus dados",
    ],
  },
];

/** Só os 5 canônicos — 1 TTS por padrão. */
export const PRIORITY_FAQ_INTENTS: readonly string[] = FAQ_AUDIO_PADROES.map((p) => p.canonicalIntent);

const INTENT_TO_PADRAO = new Map<string, string>();
for (const p of FAQ_AUDIO_PADROES) {
  for (const intent of p.intents) INTENT_TO_PADRAO.set(intent, p.key);
}

export function intentsSharingPadrao(intentName: string): string[] {
  const key = INTENT_TO_PADRAO.get(intentName);
  if (!key) return [intentName];
  return [...(FAQ_AUDIO_PADROES.find((p) => p.key === key)?.intents || [intentName])];
}

/** Números conhecidos → fala natural (evita ElevenLabs ler CNPJ/ano errado). */
function expandNumbersForSpeech(t: string): string {
  let s = t;
  // CNPJ iGreen
  s = s.replace(
    /\b44\.159\.238\/0001-30\b/g,
    "quarenta e quatro, cento e cinquenta e nove, duzentos e trinta e oito, barra zero zero zero um, trinta",
  );
  // Lei 14.300/2022
  s = s.replace(
    /\bLei\s*14\.300\/2022\b/gi,
    "Lei quatorze mil e trezentos de dois mil e vinte e dois",
  );
  s = s.replace(/\b14\.300\/2022\b/g, "quatorze mil e trezentos de dois mil e vinte e dois");
  // Anos comuns
  s = s.replace(/\bdesde\s+\*?2017\*?/gi, "desde dois mil e dezessete");
  s = s.replace(/\b2017\b/g, "dois mil e dezessete");
  s = s.replace(/\b2022\b/g, "dois mil e vinte e dois");
  // Quantidades
  s = s.replace(/\b700\s*mil\b/gi, "setecentos mil");
  s = s.replace(/\b7\s*anos\b/gi, "sete anos");
  s = s.replace(/\b100%/g, "cem por cento");
  s = s.replace(/\b30\s*a\s*90\s*dias\b/gi, "trinta a noventa dias");
  s = s.replace(/\b30\s*dias\b/gi, "trinta dias");
  s = s.replace(/\b90\s*dias\b/gi, "noventa dias");
  s = s.replace(/\b7\s*dias\b/gi, "sete dias");
  // Percentuais genéricos "X%" → "X por cento" (1–2 dígitos)
  s = s.replace(/\b(\d{1,2})\s*%/g, "$1 por cento");
  return s;
}

/** Remove markdown/emoji/{{nome}} e deixa PT-BR falável. */
export function cleanFaqBodyForTts(raw: string): string {
  let t = String(raw || "");

  // Remove fechamento legado “pode seguir / continua cadastro”
  t = t.replace(
    /(?:\n\s*)?Se estiver tudo certo, é só me dizer \*?pode seguir\*? que a gente continua seu cadastro\.[^\n]*/giu,
    "",
  );

  // Markdown antes de mexer em {{nome}} (ex.: *Zero fidelidade*, {{nome}}!)
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/[_~`]/g, "");

  // Emojis / símbolos decorativos
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🌱😊😅💡📧🙂💚✅👍]/gu, "");

  // Nome vai no áudio intro separado — remove placeholder sem deixar lixo
  t = t.replace(/^\s*\{\{\s*nome\s*\}\}\s*,\s*/gim, "");
  t = t.replace(/\{\{\s*nome\s*\}\}\s*,\s*/gi, "");
  t = t.replace(/,\s*\{\{\s*nome\s*\}\}\s*!/gi, "!");
  t = t.replace(/,\s*\{\{\s*nome\s*\}\}\s*—/gi, " —");
  t = t.replace(/,\s*\{\{\s*nome\s*\}\}\s*:/gi, ":");
  t = t.replace(/,\s*\{\{\s*nome\s*\}\}\s*\./gi, ".");
  t = t.replace(/,\s*\{\{\s*nome\s*\}\}\s*(?=\n|[A-ZÁÉÍÓÚÃÕÂÊÔÀÈÌÒÙÇ])/g, "! ");
  t = t.replace(/\{\{\s*nome\s*\}\}\s*!/gi, "!");
  t = t.replace(/\{\{\s*nome\s*\}\}/gi, "");
  t = t.replace(/,\s*([—.:;!?])/g, "$1");
  t = t.replace(/^\s*,\s*/gm, "");

  // Linha só de saudação residual (muito curta após limpar nome)
  t = t.replace(/^[^\n]{0,28},\s*!?\s*$/gm, "");

  // Normaliza pontuação e espaços
  t = t.replace(/\r/g, "");
  t = t.replace(/\n{2,}/g, "\n");
  t = t.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  t = t.replace(/\s{2,}/g, " ").trim();

  // Congruência PT-BR / pontuação residual do placeholder
  t = t.replace(/\s+,/g, ",");
  t = t.replace(/,\s*!/g, "!");
  t = t.replace(/!\s*!+/g, "!");
  t = t.replace(/\s+([.!?,;:])/g, "$1");
  t = t.replace(/([.!?])\s*([a-zà-ü])/g, (_, p, c) => `${p} ${c.toUpperCase()}`);
  t = t.replace(/\bvcs\b/gi, "vocês");
  t = t.replace(/\bvc\b/gi, "você");

  // Números → fala (depois da limpeza estrutural)
  t = expandNumbersForSpeech(t);

  // Evita CTA de mídia no corpo (não deveria existir; guarda)
  t = t.replace(/\b(manda|envie|envia)\s+(a\s+|uma\s+)?(foto|print|imagem|conta)\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();

  // Capitaliza início (após remover {{nome}})
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);

  return t;
}

export function intentToBodySlot(intentName: string): string {
  const padrao = INTENT_TO_PADRAO.get(String(intentName || ""));
  if (padrao) return `qa_body:padrao_${padrao}`;
  const slug = String(intentName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `qa_body:${slug}`;
}

export const VOICE_SETTINGS_BODY = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
};
