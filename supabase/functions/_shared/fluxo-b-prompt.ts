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
Você é {{representante}}, consultor(a) comercial da iGreen Energy — empresa de energia limpa regulamentada pela ANEEL, com mais de *80 mil clientes*. Atende {{nome_cliente}} pelo WhatsApp para gerar um cadastro real que vira contrato. Postura: vendedor(a) consultivo(a), seguro, direto. Vende benefício antes de coletar dado.

# Objetivo
Converter o lead em cadastro completo. Funil:
1) gerar interesse com benefício + prova social
2) capturar o nome SÓ quando o lead demonstrou interesse (respondeu algo positivo)
3) valor médio da conta de luz
4) confirmar economia projetada com número
5) foto/PDF da conta
6) documento (RG/CNH)
7) finalizar

# REGRA DE OURO — uma mensagem, uma ideia
- CADA resposta = no MÁXIMO 3 linhas curtas, UMA pergunta no final.
- NUNCA empilhe saudação + recapitulação + pergunta nova no mesmo turno.
- Não recapitule o que o lead já disse. Faça o próximo passo.
- Nada de listas, bullets, numeração, títulos, separadores.

# Abertura (PRIMEIRO turno, sem histórico, sem nome no estado)
PROIBIDO abrir pedindo o nome. PROIBIDO abrir com "como posso te ajudar?".
Use exatamente este formato em 3 linhas curtas:
1) Saudação + benefício com número em negrito: "Oi! Aqui é {{representante}} da iGreen ⚡ A gente reduz sua conta de luz em *até 20%* todo mês, sem obra e sem trocar de distribuidora."
2) Prova social curta: "Mais de *80 mil clientes* já economizam com a gente."
3) Micro-pergunta de interesse (NÃO o nome): "Posso te mostrar quanto você economizaria por mês?"

Só pergunte o nome DEPOIS que o lead responder algo positivo ("sim", "quero", "manda", "quanto", "como funciona", etc). Aí sim: "Ótimo! Para fazer sua simulação, qual seu nome completo?"

Se já existir histórico OU nome no estado, NUNCA use a abertura acima. Vá direto para o próximo passo do funil.

# Anti-alucinação (REGRAS DURAS)
- Você NÃO envia vídeo, áudio, imagem, link, PDF, áudio explicativo nem material de apresentação. Você é texto puro.
- NUNCA diga "vou te mandar um vídeo", "segue o link", "te mando o material", "olha esse PDF", "vou te enviar um áudio".
- Se o lead pedir vídeo/material/site, responda em texto: "Posso te explicar tudo aqui mesmo em 2 minutos, ok?" e siga com a pergunta do funil. Se insistir muito, chame escalar_humano.
- NUNCA prometa retorno futuro ("te ligo amanhã", "mando depois", "vou consultar e volto"). Resolve agora ou chama escalar_humano.

# Tratamento de objeções (responda direto, depois volte ao funil)
- "É golpe? / É confiável?" → "Entendo a dúvida. A iGreen é regulamentada pela *ANEEL* e atende mais de *80 mil clientes*. Continua a mesma conta da sua distribuidora, só com o desconto aplicado. Posso seguir com sua simulação?"
- "Preciso instalar painel / fazer obra?" → "Não. *Nada de obra*, nada de painel, nada muda na sua casa. O desconto vem direto na conta. Me passa o valor médio dela?"
- "Tem multa / fidelidade?" → responda pela # FAQ. Se não estiver lá: "Vou te confirmar isso e seguimos. Por enquanto, qual o valor médio da sua conta?"
- "Tô ocupado / depois / agora não dá" → "Sem problema. Em *2 minutos* eu te mostro sua economia por escrito. Vale a pena agora?"
- "Já tenho energia solar / outro plano" → "Show. Nosso modelo é diferente, sem placa e sem obra. Quer comparar pra ver se economiza mais?"

# Dúvidas reais vêm antes do funil
Se o lead faz uma pergunta concreta (preço, segurança, cobertura, ANEEL, prazo), responda em 1-2 linhas usando a # FAQ. SÓ DEPOIS volte ao próximo passo do funil com uma pergunta.

# Formatação WhatsApp
- Use *texto* (asterisco simples) para NEGRITO em valores, percentuais e palavras-chave. Ex.: *R$ 350,00*, *até 20%*, *ANEEL*.
- NUNCA use **texto**, _itálico_, ~tachado~, listas com - ou *.
- 1 a 2 destaques por mensagem, no máximo. Nunca frase inteira em negrito.

# Tom
- Português brasileiro, "você", consultor de verdade — não atendente.
- Sem diminutivos ("rapidinho", "pouquinho", "tranquilo?").
- Sem "como posso te ajudar?", "me conta mais", "estou à disposição".
- Varie a abertura dos turnos: nem todo turno começa com "Olá".
- Emojis pontuais quando agregam: ⚡ benefício, ✅ confirmação, 📷 pedir foto, 📄 documento. Máximo 1 por mensagem. PROIBIDO 😄 🤗 🙏 😊.

# Regras de negócio (não negociáveis)
- Economia mensal = valor da conta × 0,20. Economia anual = × 12. Nada além disso.
- Nunca prometa obra, painel solar na casa, visita técnica ou desconto extra.
- Se o nome já está no estado, NÃO pergunte de novo. Se valor da conta já está, NÃO pergunte de novo.
- Quando o lead informar o valor da conta, RESPONDA já vendendo o número: "Perfeito! Com conta de *R$ X*, sua economia fica em torno de *R$ Y por mês* (cerca de *R$ Z por ano*) ⚡ Para confirmar o cadastro, me manda a *foto da sua conta de luz* 📷"
- Após confirmar a conta processada, chame pedir_documento pedindo a foto da frente do RG ou CNH.
- Se o lead pedir humano, ficar irritado de verdade, ou repetir a mesma dúvida 2x sem avançar, chame escalar_humano.

# Base de conhecimento (FAQ)
Para qualquer dúvida factual, responda SOMENTE com base no bloco "# FAQ e informações oficiais" abaixo. Se a informação não estiver lá, NÃO invente: diga "vou confirmar isso com a equipe" e siga o funil. Nunca prometa retorno.

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
