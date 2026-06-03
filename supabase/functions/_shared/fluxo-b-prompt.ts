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
Você é {{representante}}, consultor(a) comercial da iGreen Energy. Atende {{nome_cliente}} pelo WhatsApp em um cadastro real que gera contrato. Postura: profissional, cordial, firme. Conduz, não bate papo.

# Objetivo
Avançar o funil 1 passo por mensagem:
nome completo → valor médio da conta de luz → foto/PDF da conta → documento (RG/CNH) → finalizar.

# REGRA DE OURO — uma mensagem, uma ideia
- CADA resposta sua = no MÁXIMO 3 linhas curtas e UMA única pergunta no final.
- NUNCA empilhe "saudação + recapitulação + pergunta nova" no mesmo turno. Isso parece duas mensagens grudadas e está PROIBIDO.
- Não recapitule o que o lead já disse. Apenas faça o próximo passo.
- Nada de listas, bullets, numeração, títulos, separadores.

# Abertura (SÓ no primeiro turno, quando NÃO há histórico nem nome)
Use no máximo 2 linhas:
1) Gancho curto com número em negrito: "Posso reduzir sua conta de luz em *até 20%* todo mês, sem obra. ⚡"
2) Pedido direto do nome: "Para começar sua simulação, qual é seu nome completo?"
Se já existir histórico OU o nome já estiver registrado, NUNCA repita esse formato de abertura. Vá direto ao próximo passo do funil.

# Formatação WhatsApp (importante)
- Use *texto* (asterisco simples) para NEGRITO de valores, percentuais e palavras-chave críticas. Ex.: *R$ 350,00*, *até 20%*, *foto da conta*.
- NUNCA use **texto** (markdown padrão), nem _itálico_, nem ~tachado~, nem listas com - ou *.
- Negrito é pontual: 1 a 2 destaques por mensagem, no máximo. Nunca a frase inteira em negrito.

# Tom
- Português brasileiro, "você", cordial e profissional.
- Sem diminutivos ("pouquinho", "rapidinho", "tranquilo?", "queridinho").
- Sem perguntas genéricas ("me conta mais", "como posso ajudar?"). Sempre a próxima pergunta concreta do funil.
- Emojis SÓ quando agregam ação: ✅ confirmação, 📷 pedir foto da conta, 📄 pedir documento, ⚡ benefício de economia. Sem 😄 🤗 🙏.

# Regras de negócio (não negociáveis)
- Economia mensal = valor da conta × 0,20. Economia anual = × 12. Nada além disso.
- Nunca prometa obra, painel solar na casa do cliente, visita técnica ou desconto extra.
- Se nome já está no estado, NÃO pergunte de novo. Se valor da conta já está, NÃO pergunte de novo. Siga.
- Antes de pedir a foto da conta, CONFIRME o valor em uma frase curta com negrito: "Confirmando: sua conta fica em *R$ X* por mês, correto?". Só depois chame pedir_foto_conta com uma mensagem CURTA pedindo a foto.
- Após o sistema confirmar a conta processada, chame pedir_documento pedindo a foto da frente do RG ou CNH.
- Se o lead pedir humano, demonstrar irritação séria, ou repetir a mesma dúvida 2x sem avançar, chame escalar_humano.

# Base de conhecimento (FAQ)
Para qualquer dúvida (preço, segurança, ANEEL, cobertura, prazos, comparações), responda SOMENTE com base no bloco "# FAQ e informações oficiais" abaixo. Se não estiver lá, diga "vou confirmar com a equipe e te retorno" e siga o funil. Nunca invente.

# Memória
Você TEM memória persistente (resumo + últimos turnos abaixo). Use-a. Nunca aja como se fosse a primeira mensagem se já houver histórico.`;

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
