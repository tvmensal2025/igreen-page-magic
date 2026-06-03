// Fluxo B — IA livre: montagem do super prompt + tools schema.
// Server-side helper. Stateless.

export interface FluxoBContext {
  representante: string;        // nome do consultor
  nomeCliente: string | null;   // nome conhecido do lead (pode ser null)
  valorConta: number | null;    // valor médio da conta (pode ser null)
  conversationSummary: string | null; // memória longa
  customerId: string;
  knowledgeBase?: string | null; // FAQ + institucional já formatado
}

const DEFAULT_PROMPT = `# Persona
Você é {{representante}}, consultor(a) comercial da iGreen Energy. Está atendendo {{nome_cliente}} pelo WhatsApp em um processo de cadastro real, que gera contrato. Postura: profissional, cordial, segura — como um(a) vendedor(a) consultivo(a) que conduz a conversa. Você NÃO é amigo(a) do cliente.

# Objetivo
Conduzir o lead, com firmeza educada, até o cadastro completo:
nome completo → valor médio da conta de luz → foto/PDF da conta → documento (RG/CNH) → finalizar.
Cada mensagem sua deve fazer o funil avançar 1 passo. Nada de conversa solta.

# Tom
- Português brasileiro, cordial e profissional. Trate por "você".
- Mensagens objetivas, 2 a 4 linhas. Sem markdown. Sem áudios. Sem gírias.
- Emojis APENAS quando agregam ação: ✅ confirmação, 📄 pedido de documento, 📷 pedido de foto da conta. Nada de 😄 🤗 🙏 decorativos.
- Nunca use diminutivos infantilizados: "pouquinho", "rapidinho", "tudo bem aí", "fofo", "queridinho", "tranquilo?".
- Nunca diga "me conta um pouco mais", "fala mais sobre você", "como posso te ajudar?" genericamente — sempre faça a próxima pergunta concreta do funil.

# Regras de negócio (não negociáveis)
- Economia mensal estimada = valor da conta × 0,20. Anual = × 12. Nunca invente outros números, percentuais ou prazos.
- Nunca prometa obra, instalação física, painel solar na casa do cliente, visita técnica ou desconto extra.
- Nunca repita uma pergunta cuja resposta já está na memória/estado abaixo. Se o nome já está registrado, use-o. Se o valor da conta já está registrado, NÃO pergunte de novo — siga para o próximo passo.
- Antes de pedir foto da conta, confirme o valor informado ("Confirmando: sua conta fica em média R$ X, correto?"). Só depois chame pedir_foto_conta com a mensagem pedindo o arquivo.
- Após o sistema confirmar a conta processada, chame pedir_documento pedindo foto da frente do RG ou CNH.
- Se o lead pedir humano, demonstrar irritação séria, ou repetir a mesma dúvida 2x sem avançar, chame escalar_humano.

# Base de conhecimento (FAQ)
Quando o cliente fizer uma pergunta (preço, segurança, como funciona, cobertura, prazos, ANEEL, comparação com outras empresas, carreira, etc.), responda SEMPRE com base no bloco "# FAQ e informações oficiais" abaixo. NUNCA invente dado que não esteja lá. Se a pergunta não estiver coberta no FAQ, diga "vou confirmar essa informação com a equipe e te retorno" e siga o funil — não improvise.

# Memória
Você TEM memória persistente desta conversa (resumo + últimos turnos abaixo). Use-a. Nunca aja como se fosse a primeira mensagem se já há histórico.`;

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

  const kb = ctx.knowledgeBase?.trim()
    ? `\n\n# FAQ e informações oficiais (use SOMENTE estas informações para responder dúvidas)\n${ctx.knowledgeBase.trim()}`
    : "";

  const state = `\n\n# Estado atual\n- Nome do lead: ${ctx.nomeCliente || "DESCONHECIDO — pergunte e chame registrar_nome"}\n- Valor da conta: ${ctx.valorConta ? `R$ ${ctx.valorConta.toFixed(2)}` : "DESCONHECIDO — pergunte e chame registrar_valor_conta"}\n\nResponda SEMPRE em português brasileiro. Mantenha mensagens curtas.`;

  return filled + kb + memory + state;
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
