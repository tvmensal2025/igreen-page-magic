// Templates iniciais para o editor de fluxo. Lista estática — sem nova tabela.
// Cada template é uma sequência de passos que será inserida no flow atual,
// preservando step_keys legados quando aplicável (pra continuar funcionando
// com whapi-webhook).

export type TemplateStepSeed = {
  step_key: string;
  step_type: string;
  title: string;
  summary?: string;
  icon?: string;
  message_text?: string;
  slot_key?: string;
  /** Ordem de envio WA: audio/text/image/video. Persistido em bot_flow_steps.media_order. */
  media_order?: string[];
  /**
   * Transitions do seed. `goto_step_key` é resolvido para UUID no apply
   * (FlowTemplatesDialog); o runtime só usa `goto_step_id`.
   */
  transitions?: Array<{
    trigger_intent: string;
    trigger_phrases: string[];
    goto_step_id?: string | null;
    /** Destino por step_key — resolvido no apply. */
    goto_step_key?: string | null;
    goto_special?: "cadastro" | "humano" | "repeat" | "ai" | null;
  }>;
  captures?: any[];
  fallback?: any;
};

export type FlowTemplate = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  steps: TemplateStepSeed[];
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "captacao_meta_ads",
    name: "Captação Meta Ads (Fluxo D)",
    emoji: "🎯",
    description:
      "Otimizado para anúncios Meta. Fluxo rápido por botões: simular → conta → economia → cadastro. Ideal para tráfego pago.",
    steps: [
      {
        step_key: "welcome",
        step_type: "message",
        title: "Boas-vindas (Meta Ads)",
        icon: "msg",
        message_text:
          "Oi, {{nome}}! 👋\n\nVi que você se interessou pelo nosso anúncio de *energia solar por assinatura*.\n\n💡 *Economize até 20% na conta de luz*, sem obra e sem instalação.\n\nBora calcular *sua economia* agora? 👇",
        slot_key: "welcome_meta",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "simular", title: "📸 Quero simular" },
          { id: "duvida", title: "🤔 Tenho dúvida" },
        ]}],
      },
      {
        step_key: "aguardando_conta",
        step_type: "capture_conta",
        title: "Captar conta de luz",
        icon: "file",
        message_text:
          "Show! 📸 Me manda uma *foto da sua conta de luz* (pode ser do mês atual ou anterior).\n\nÉ rapidinho — em segundos eu calculo sua economia. 💚",
        slot_key: "aguardando_conta",
      },
      {
        step_key: "resultado_simulacao",
        step_type: "message",
        title: "Resultado da simulação",
        icon: "sparkle",
        message_text:
          "🎉 *Pronto, {{nome}}!*\n\nCom base na sua conta de *R$ {{valor_conta}}*, você vai economizar:\n\n💰 *{{economia_range}} por mês*\n📅 Até *R$ 1.080/ano*\n\n✅ Sem obra\n✅ Sem instalação\n✅ Mesma distribuidora\n✅ Cancela quando quiser\n\nBora finalizar seu cadastro? 🚀",
        slot_key: "resultado_simulacao",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "cadastrar", title: "✅ Cadastrar agora" },
          { id: "duvida", title: "❓ Tenho dúvidas" },
          { id: "humano", title: "👤 Falar com humano" },
        ]}],
      },
      {
        step_key: "aguardando_doc_auto",
        step_type: "capture_documento",
        title: "Captar documento",
        icon: "file",
        message_text:
          "Perfeito! 🪪\n\nMe manda uma *foto da frente do seu documento* (RG ou CNH).\n\nVou usar pra preencher seu cadastro automaticamente.",
        slot_key: "aguardando_doc_auto",
      },
      {
        step_key: "finalizar_cadastro",
        step_type: "finalizar_cadastro",
        title: "Finalizar cadastro",
        icon: "sparkle",
        message_text:
          "Pronto, {{nome}}! 🎉\n\nSeu *cadastro foi enviado*. Em até *2 dias úteis* sua *conta nova* chega no e-mail.\n\nQualquer dúvida, é só me chamar! 💚",
        slot_key: "finalizar_cadastro",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "finalizar", title: "✅ Finalizar" },
        ]}],
      },
    ],
  },
  {
    id: "captacao_solar",
    name: "Captação solar (completo)",
    emoji: "☀️",
    description: "Boas-vindas → como funciona → captação da conta → cadastro.",
    steps: [
      {
        step_key: "welcome",
        step_type: "message",
        title: "Boas-vindas",
        icon: "msg",
        message_text:
          "Oi, {{nome}}! 😊\n\nAqui é o *{{representante}}*, da *iGreen Energy*. 🌱\n\nVocê pode economizar *até 20%* na sua conta de luz, *sem instalar nada*.\n\nQuer que eu te mostre *como funciona*? 👇",
        slot_key: "welcome",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "simular", title: "📸 Quero simular" },
          { id: "como", title: "🤔 Como funciona?" },
        ]}],
      },
      {
        step_key: "como_funciona",
        step_type: "message",
        title: "Como funciona",
        icon: "msg",
        message_text:
          "É *bem simples*, {{nome}} 👇\n\nVocê continua na *mesma distribuidora*, recebe a *mesma energia* — só que paga *até 20% menos* todo mês.\n\n✅ Sem obra\n✅ Sem instalação\n✅ Sem fidelidade\n\nBora *simular* agora? 🚀",
        slot_key: "como_funciona",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "simular", title: "📸 Quero simular" },
        ]}],
      },
      {
        step_key: "aguardando_conta",
        step_type: "capture_conta",
        title: "Captar conta de luz",
        icon: "file",
        message_text: "📸 Me manda uma *foto da sua conta de luz* pra eu calcular sua *economia* na hora. 💚\n\n(pode ser a fatura do *mês atual* ou a anterior)",
        slot_key: "aguardando_conta",
      },
      {
        step_key: "pre_cadastro",
        step_type: "message",
        title: "Confirmar dados",
        icon: "msg",
        message_text:
          "Show, {{nome}}! 🎉\n\nSua economia vai ser de *{{economia_range}}* por mês. 💚\n\nPra cadastrar, só preciso confirmar uma coisinha 👇\n\nEste WhatsApp (*{{telefone}}*) é o *melhor número* pra contato?",
        slot_key: "pre_cadastro",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "sim", title: "✅ Sim" },
          { id: "nao", title: "📱 Usar outro" },
        ]}],
      },
      {
        step_key: "finalizar_cadastro",
        step_type: "finalizar_cadastro",
        title: "Finalizar cadastro",
        icon: "sparkle",
        message_text: "Pronto, {{nome}}! 🎉\n\nSeu *cadastro foi enviado* com sucesso.\n\n📬 Em até *2 dias úteis* sua *conta nova* chega no seu e-mail.\n\nQualquer dúvida, é só me chamar aqui! 💚",
        slot_key: "finalizar_cadastro",
      },
    ],
  },
  {
    id: "captacao_simples",
    name: "Captação simples (3 passos)",
    emoji: "⚡",
    description: "Pitch direto → conta de luz → cadastro. Para listas quentes.",
    steps: [
      {
        step_key: "welcome",
        step_type: "message",
        title: "Pitch direto",
        icon: "msg",
        message_text:
          "Oi, {{nome}}! 😊\n\nSou o *{{representante}}* 🌱\n\nConsigo te dar *até 20% de desconto fixo* na conta de luz — *sem instalar nada*.\n\n📸 Me manda a foto da *última conta* que eu já calculo sua *economia*?",
        slot_key: "welcome",
      },
      {
        step_key: "aguardando_conta",
        step_type: "capture_conta",
        title: "Captar conta",
        icon: "file",
        message_text: "📸 Pode mandar a *foto da conta* aqui mesmo. 💚",
        slot_key: "aguardando_conta",
      },
      {
        step_key: "finalizar_cadastro",
        step_type: "finalizar_cadastro",
        title: "Finalizar",
        icon: "sparkle",
        message_text: "Beleza, {{nome}}! ✅\n\n*Cadastro enviado* com sucesso.\n\n⏳ Em até *24h* eu te aviso aqui no WhatsApp. 💚",
        slot_key: "finalizar_cadastro",
      },
    ],
  },
  {
    id: "conexao_club",
    name: "Conexão Club (indicações)",
    emoji: "🤝",
    description: "Pitch do programa de indicações Conexão Club + dúvidas.",
    steps: [
      {
        step_key: "pitch_conexao_club",
        step_type: "message",
        title: "Pitch Conexão Club",
        icon: "msg",
        message_text:
          "{{nome}}, tenho uma novidade pra você 💰\n\nAlém da sua *economia* todo mês, agora você pode *ganhar cashback* indicando amigos no *Conexão Club*. 🤝\n\nQuer saber *como funciona*? 👇",
        slot_key: "pitch_conexao_club",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "sim", title: "✅ Quero saber" },
          { id: "nao", title: "❌ Agora não" },
        ]}],
      },
      {
        step_key: "duvidas_pos_club",
        step_type: "message",
        title: "Tirar dúvidas",
        icon: "msg",
        message_text: "Ficou alguma *dúvida* sobre o *Conexão Club*? 🤔\n\nPode mandar aqui que eu te explico 👇",
        slot_key: "duvidas_pos_club",
      },
    ],
  },
  {
    id: "reengajamento",
    name: "Reengajamento (lead frio)",
    emoji: "🔁",
    description: "Volta com o lead que sumiu — 1 mensagem + CTA forte.",
    steps: [
      {
        step_key: "welcome",
        step_type: "message",
        title: "Reengajamento",
        icon: "msg",
        message_text:
          "Oi, {{nome}}! Voltei aqui 👋\n\nAquela *economia de até 20%* na conta de luz ainda *tá de pé*. 💚\n\nBora *simular agora* e ver quanto você economiza? 🚀",
        slot_key: "welcome",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "simular", title: "📸 Quero simular" },
          { id: "humano", title: "👤 Falar com humano" },
        ]}],
      },
    ],
  },
  {
    id: "pos_venda",
    name: "Pós-venda (cliente novo)",
    emoji: "🎁",
    description: "Mensagem de boas-vindas pós-cadastro + Conexão Club.",
    steps: [
      {
        step_key: "welcome",
        step_type: "message",
        title: "Boas-vindas pós-cadastro",
        icon: "sparkle",
        message_text:
          "{{nome}}, *parabéns* por entrar pra *iGreen*! 🎉\n\nEm até *2 faturas* você já vê a *economia de até 20%* na sua conta. 💚\n\nQualquer dúvida, é só me *chamar aqui*. 🙌",
        slot_key: "welcome",
      },
      {
        step_key: "pitch_conexao_club",
        step_type: "message",
        title: "Convite Conexão Club",
        icon: "msg",
        message_text:
          "E olha só essa novidade 👇\n\nAgora você pode *ganhar cashback* indicando amigos no *Conexão Club*. 💰\n\nQuer que eu te mostre *como funciona*?",
        slot_key: "pitch_conexao_club",
        captures: [{ field: "_buttons", enabled: true, value: [
          { id: "sim", title: "✅ Mostrar" },
          { id: "nao", title: "❌ Depois" },
        ]}],
      },
    ],
  },
  {
    id: "confirmacao_pos_ocr",
    name: "Confirmação pós-OCR (dados + email + telefone)",
    emoji: "✅",
    description:
      "Depois do OCR da conta e documento: confirma dados, pede e-mail e confirma telefone.",
    steps: [
      {
        step_key: "confirmar_dados",
        step_type: "message",
        title: "Confirmar dados extraídos",
        icon: "msg",
        message_text:
          "Consegui ler aqui, {{nome}} 👇\n\n👤 *Nome:* {{nome}}\n🪪 *CPF:* {{cpf}}\n💡 *Valor da conta:* R$ {{valor_conta}}\n\nEstá *tudo certo*? ✅",
        slot_key: "confirmar_dados",
        captures: [
          {
            field: "_buttons",
            enabled: true,
            value: [
              { id: "sim", title: "✅ Sim, está certo" },
              { id: "nao", title: "✏️ Não, editar" },
              { id: "humano", title: "👤 Falar com humano" },
            ],
          },
        ],
      },
      {
        step_key: "pedir_email",
        step_type: "capture_email",
        title: "Pedir e-mail",
        icon: "msg",
        message_text:
          "Show! 🙌\n\nAgora me passa o seu *e-mail* pra eu finalizar o cadastro 📧\n\n(ex.: *joao@email.com*)",
        slot_key: "pedir_email",
        captures: [{ field: "email", enabled: true } as any],
      },
      {
        step_key: "confirmar_telefone",
        step_type: "confirm_phone",
        title: "Confirmar telefone",
        icon: "msg",
        message_text:
          "Última confirmação, {{nome}} 👇\n\n📱 *{{telefone}}*\n\nEsse mesmo número é o seu *WhatsApp para contato*?",
        slot_key: "confirmar_telefone",
        captures: [
          {
            field: "_buttons",
            enabled: true,
            value: [
              { id: "sim", title: "✅ Sim, é esse" },
              { id: "editar", title: "✏️ Quero editar" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "sofia_ativacao_multicanal",
    name: "Sofia — Ativação Multicanal",
    emoji: "🌱",
    description:
      "Grupo A 100%: 1 nome → 2 áudio+valor → 3 texto+áudio+botões → 4 clube → 5 conta → 6 doc → 7 e-mail → 8 tel → 9 OTP → 10 facial. Sem SP/MG.",
    steps: [
      {
        step_key: "a1_ask_name",
        step_type: "capture_name",
        title: "1 — Pedir NOME (aguardar digitar)",
        icon: "user",
        message_text:
          "*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.",
        slot_key: "a1_ask_name",
        captures: [{ field: "name", enabled: true }],
      },
      {
        step_key: "a2_text_ask_bill_value",
        step_type: "message",
        title: "2 — Áudio bem-vindo/bem-vinda + texto pedir valor",
        icon: "sparkle",
        message_text:
          "{{nome}}, conseguimos ativar o seu benefício!\n\nPara eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.\n\nPode ser só o número — por exemplo: 350 ou 850,00.",
        slot_key: "a2_audio_activate_name",
        media_order: ["audio", "text"],
        captures: [{ field: "electricity_bill_value", enabled: true }],
      },
      {
        step_key: "a3_explain_with_buttons",
        step_type: "message",
        title: "3 — Texto + áudio ({{nome}}) + botões",
        icon: "msg",
        message_text:
          "Perfeito, *{{nome}}*!\n\nCom base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.\n\n*O que você prefere agora*?",
        slot_key: "a3_explain_with_buttons",
        media_order: ["audio", "text"],
        captures: [
          {
            field: "_buttons",
            enabled: true,
            value: [
              { id: "more_benefits", title: "Saber mais benefício" },
              { id: "activate", title: "Quero ativar" },
              { id: "human", title: "Falar com humano" },
            ],
          },
        ],
        transitions: [
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["more_benefits", "Saber mais benefício", "1"],
            goto_step_id: null,
            goto_step_key: "a5b_after_club_buttons",
            goto_special: null,
          },
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["activate", "Quero ativar", "2"],
            goto_step_id: null,
            goto_step_key: "a6_ask_bill_photo",
            goto_special: null,
          },
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["human", "Falar com humano", "3"],
            goto_step_id: null,
            goto_special: "humano",
          },
        ],
      },
      {
        step_key: "a5b_after_club_buttons",
        step_type: "message",
        title: "4 — Áudio clube + Cadastrar / Humano",
        icon: "sparkle",
        message_text: "{{nome}}, quer seguir com o cadastro para ativar o seu benefício?",
        slot_key: "a5_audio_club_benefits",
        media_order: ["audio", "text"],
        captures: [
          {
            field: "_buttons",
            enabled: true,
            value: [
              { id: "register", title: "Cadastrar" },
              { id: "human", title: "Falar com humano" },
            ],
          },
        ],
        transitions: [
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["register", "Cadastrar", "1"],
            goto_step_id: null,
            goto_step_key: "a6_ask_bill_photo",
            goto_special: null,
          },
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["human", "Falar com humano", "2"],
            goto_step_id: null,
            goto_special: "humano",
          },
        ],
      },
      {
        step_key: "a6_ask_bill_photo",
        step_type: "capture_conta",
        title: "5 — Pedir foto da conta (OCR)",
        icon: "file",
        message_text:
          "Perfeito, {{nome}}!\n\nPara seguir com a ativação, me envie uma foto nítida da sua conta de luz mais recente (a página com o valor e os dados da unidade).\n\nAssim consigo validar os dados automaticamente e continuar o seu atendimento, {{nome}}.",
        slot_key: "a6_ask_bill_photo",
      },
      {
        step_key: "a7_ask_document",
        step_type: "capture_documento",
        title: "6 — Pedir documento",
        icon: "file",
        message_text:
          "Obrigado, {{nome}}.\n\nAgora me envie a foto do seu documento:\n• *CNH* → só a *frente*\n• *RG* → *frente e verso* (obrigatório)\n\nPreciso das fotos nítidas para ler os dados e continuar a ativação.",
        slot_key: "a7_ask_document",
        captures: [
          {
            kind: "media",
            name: "documento_cliente",
            accepts: ["image", "document"],
            required: true,
            retry_text: "Pode reenviar a *foto do documento* (RG ou CNH)?",
            auto_detect_doc_type: true,
          } as any,
        ],
      },
      {
        step_key: "a8_ask_email",
        step_type: "capture_email",
        title: "7 — Pedir e-mail",
        icon: "msg",
        message_text:
          "{{nome}}, me passa seu *e-mail* 📧\n\n_É por ele que você vai acessar o app *iGreen Club* 📱 (cashback, faturas e indicações)._",
        slot_key: "a8_ask_email",
        captures: [
          {
            kind: "text",
            name: "email",
            required: true,
            retry_text: "Esse e-mail parece inválido. Pode reenviar?",
          } as any,
        ],
      },
      {
        step_key: "a9_confirm_phone",
        step_type: "confirm_phone",
        title: "8 — Confirmar telefone",
        icon: "msg",
        message_text:
          "{{nome}}, só para confirmar: o telefone deste WhatsApp é o melhor para contato?\n\nNúmero: {{telefone}}",
        slot_key: "a9_confirm_phone",
        captures: [
          { kind: "text", name: "telefone", required: true } as any,
          {
            field: "_buttons",
            enabled: true,
            value: [
              { id: "phone_ok", title: "Sim, este número" },
              { id: "phone_other", title: "Quero outro" },
              { id: "human", title: "Falar com humano" },
            ],
          },
        ],
        transitions: [
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["phone_ok", "Sim, este número", "sim", "Sim", "1"],
            goto_step_id: null,
            goto_step_key: "a10_portal_otp_facial",
            goto_special: null,
          },
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["phone_other", "Quero outro", "editar", "2"],
            goto_step_id: null,
            goto_special: "repeat",
          },
          {
            trigger_intent: "palavra_chave",
            trigger_phrases: ["human", "Falar com humano", "3"],
            goto_step_id: null,
            goto_special: "humano",
          },
        ],
      },
      {
        step_key: "a10_portal_otp_facial",
        step_type: "finalizar_cadastro",
        title: "9 — Portal + digitar OTP",
        icon: "sparkle",
        message_text:
          "Pronto, {{nome}}!\n\nJá temos todos os dados. Vou enviar o seu cadastro ao portal agora.\n\nEm seguida você recebe um *código OTP*. Digite esse código aqui no WhatsApp para eu confirmar 👇\n\n_(O link da validação facial só vem depois que o OTP estiver certo.)_",
        slot_key: "a10_portal_otp_facial",
      },
      {
        step_key: "a11_facial_link",
        step_type: "message",
        title: "10 — Link da facial (após OTP)",
        icon: "sparkle",
        message_text:
          "OTP confirmado, {{nome}}! ✅\n\nÚltimo passo: abra o *link* 👇\n\n{{link_facial}}\n\nClique em *Assinar documentos* — o sistema vai pedir a *validação facial* para comprovar que é você.",
        slot_key: "a11_facial_link",
      },
    ],
  },
];

