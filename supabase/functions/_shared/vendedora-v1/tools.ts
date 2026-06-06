// Tools que o Writer pode chamar.

export const WRITER_TOOLS = [
  {
    type: "function",
    function: {
      name: "registrar_nome",
      description: "Salva o nome do lead.",
      parameters: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_valor_conta",
      description: "Salva o valor médio mensal da conta de luz em reais.",
      parameters: { type: "object", properties: { valor: { type: "number" } }, required: ["valor"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_info",
      description: "Salva uma informação genérica do lead (cidade, distribuidora, melhor_horario, profissao, tamanho_casa, etc).",
      parameters: {
        type: "object",
        properties: {
          campo: { type: "string", description: "ex: cidade, distribuidora, melhor_horario" },
          valor: { type: "string" },
        },
        required: ["campo", "valor"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_objecao_tratada",
      description: "Marca que uma objeção já foi tratada pra não repetir o mesmo argumento.",
      parameters: {
        type: "object",
        properties: { tipo: { type: "string", description: "ex: golpe, obra, fidelidade, solar, tempo" } },
        required: ["tipo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_foto_conta",
      description: "Próximo passo: receber foto/PDF da conta. Combine com mensagem curta.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_documento",
      description: "Próximo passo: receber foto do RG/CNH. Combine com mensagem curta.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_followup",
      description: "Agenda um follow-up quando o lead pediu pra falar depois.",
      parameters: {
        type: "object",
        properties: {
          quando_iso: { type: "string", description: "ISO datetime do retorno" },
          gancho: { type: "string", description: "gancho curto pra reabrir conversa" },
        },
        required: ["quando_iso", "gancho"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "marcar_quente",
      description: "Sobe prioridade do lead no CRM quando temperatura alta.",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_email",
      description: "Salva o e-mail do lead. SEMPRE chame quando o lead enviar um e-mail válido. Validação básica feita no servidor.",
      parameters: {
        type: "object",
        properties: { email: { type: "string", description: "e-mail do lead" } },
        required: ["email"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirmar_telefone",
      description: "Quando o lead confirma que o WhatsApp atual é o melhor contato OU passa outro número. Telefone só com dígitos (DDI+DDD+número).",
      parameters: {
        type: "object",
        properties: { telefone: { type: "string" } },
        required: ["telefone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_humano_proativo",
      description: "IA decide proativamente que precisa humano (caso complexo, frustração séria).",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_humano",
      description: "Lead pediu humano explicitamente. Pausa o bot.",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "finalizar_cadastro",
      description: "Chame quando você já tem nome completo, valor da conta, e-mail, foto da conta e foto do documento confirmados. O servidor valida e envia ao portal automaticamente. Se faltar algo, o sistema vai te avisar e você pede o que falta.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
] as const;
