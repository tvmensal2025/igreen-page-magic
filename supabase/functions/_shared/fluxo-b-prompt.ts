// Fluxo B — IA livre: montagem do super prompt + tools schema.
// Server-side helper. Stateless.

export interface FluxoBContext {
  representante: string;        // nome do consultor
  nomeCliente: string | null;   // nome conhecido do lead (pode ser null)
  valorConta: number | null;    // valor médio da conta (pode ser null)
  conversationSummary: string | null; // memória longa
  customerId: string;
}

const DEFAULT_PROMPT = `# Persona
Você é {{representante}}, consultor(a) da iGreen Energy. Está atendendo {{nome_cliente}} pelo WhatsApp.

# Objetivo
Levar o lead até o cadastro completo (nome → valor da conta → foto da conta → documento → finalizar).

# Tom
Brasileiro, próximo, mensagens CURTAS (1–3 linhas). Sem formalidade. Emojis com moderação.

# Regras
- Economia = valor × 0.20 por mês, × 12 por ano. Nunca invente.
- Nunca prometa obra/instalação na casa.
- Se o lead pedir humano ou demonstrar irritação séria, chame escalar_humano.
- Quando achar que é hora de pedir foto da conta, chame pedir_foto_conta + mensagem curta.
- Após confirmação da conta pelo sistema, chame pedir_documento + mensagem curta.`;

export function buildFluxoBSystemPrompt(
  basePrompt: string | null | undefined,
  ctx: FluxoBContext,
): string {
  const prompt = (basePrompt && basePrompt.trim()) || DEFAULT_PROMPT;
  const filled = prompt
    .replace(/\{\{\s*representante\s*\}\}/gi, ctx.representante || "Rafael")
    .replace(/\{\{\s*nome_cliente\s*\}\}/gi, ctx.nomeCliente || "(ainda não sei o nome)")
    .replace(/\{\{\s*nome\s*\}\}/gi, ctx.nomeCliente || "")
    .replace(/\{\{\s*valor_conta\s*\}\}/gi, ctx.valorConta ? `R$ ${ctx.valorConta.toFixed(2)}` : "(ainda não sei)");

  const memory = ctx.conversationSummary?.trim()
    ? `\n\n# Memória da conversa\n${ctx.conversationSummary.trim()}`
    : "";

  const state = `\n\n# Estado atual\n- Nome do lead: ${ctx.nomeCliente || "DESCONHECIDO — pergunte e chame registrar_nome"}\n- Valor da conta: ${ctx.valorConta ? `R$ ${ctx.valorConta.toFixed(2)}` : "DESCONHECIDO — pergunte e chame registrar_valor_conta"}\n\nResponda SEMPRE em português brasileiro. Mantenha mensagens curtas.`;

  return filled + memory + state;
}

// Tools que a IA pode chamar. Schema OpenAI/Lovable AI compatível.
export const FLUXO_B_TOOLS = [
  {
    type: "function",
    function: {
      name: "registrar_nome",
      description: "Salva o nome (primeiro nome ou nome completo) que o lead acabou de informar.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome capturado do lead, do jeito que ele falou (sem normalizar)" },
        },
        required: ["nome"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_valor_conta",
      description: "Salva o valor médio em reais da conta de luz do lead (apenas número, sem 'R$').",
      parameters: {
        type: "object",
        properties: {
          valor: { type: "number", description: "Valor em reais, ex.: 350.00" },
        },
        required: ["valor"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_foto_conta",
      description: "Sinaliza que o próximo passo é receber a foto/PDF da conta de luz. Use SEMPRE em conjunto com uma mensagem curta de texto pedindo o arquivo.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_documento",
      description: "Sinaliza que o próximo passo é receber a foto do documento (RG/CNH). Use SEMPRE em conjunto com uma mensagem curta.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "finalizar_cadastro",
      description: "Encerra a conversa e aciona o pipeline de cadastro final. Use após documento confirmado.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_humano",
      description: "Pausa o bot e chama um humano. Use quando o lead pedir humano, demonstrar irritação séria, ou ficar travado.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Resumo curto do motivo da escalada" },
        },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
  },
] as const;

export type FluxoBToolCall =
  | { name: "registrar_nome"; arguments: { nome: string } }
  | { name: "registrar_valor_conta"; arguments: { valor: number } }
  | { name: "pedir_foto_conta"; arguments: Record<string, never> }
  | { name: "pedir_documento"; arguments: Record<string, never> }
  | { name: "finalizar_cadastro"; arguments: Record<string, never> }
  | { name: "escalar_humano"; arguments: { motivo: string } };

export const DEFAULT_FLUXO_B_PROMPT = DEFAULT_PROMPT;
