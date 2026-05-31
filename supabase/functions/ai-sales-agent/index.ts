// AI Sales Agent — decide a melhor ação na conversa de WhatsApp.
// Recebe contexto do lead + histórico + mídias disponíveis e usa Lovable AI
// Gateway com tool-calling para retornar UMA decisão (send_text, send_media,
// request_handoff, schedule_followup, advance_to_closing, mark_lost).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { geminiGenerate, type GeminiTool } from "../_shared/gemini.ts";
import { shouldSkipShortCircuit } from "../_shared/bot/orchestrator-gate.ts";
import { isCustomerPausedByHuman, isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Modelos por tarefa (Google API direto)
// Default: flash rápido. Pro só em situações que valem a latência extra (objeção, alto score, fechamento).
const MODEL_DEFAULT = "gemini-2.5-flash";          // resposta padrão (rápida, 1-2s)
const MODEL_DECISION = "gemini-2.5-pro";           // decisão complexa (objeção/fechamento)
const MODEL_RESCUE = "gemini-2.5-flash";           // resgate / texto rápido
const MODEL_SELFCHECK = "gemini-2.5-flash-lite";   // self-check barato
const MODEL_FALLBACK = "gemini-2.5-flash";         // se Pro retornar 429

// ---------- Tools available to the LLM (OpenAI-style; convertidas para Google abaixo) ----------
const tools = [
  {
    type: "function",
    function: {
      name: "send_text",
      description:
        "Envia uma mensagem de texto humanizada (PT-BR, curta, no máx 2 frases). Use para abertura, qualificação, pitch ou tratamento simples de objeção.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Texto exato a enviar" },
          next_phase: {
            type: "string",
            enum: ["abertura", "descoberta", "pitch", "objecao", "fechamento"],
          },
          score_delta: {
            type: "number",
            description: "Quanto somar/subtrair no qualification_score (0-100). +20 se demonstrou interesse forte, +10 se respondeu engajado, 0 se neutro, -10 se mostrou objeção forte, -20 se desistiu.",
          },
          reasoning: { type: "string", description: "Por que essa resposta" },
        },
        required: ["message", "next_phase", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_media",
      description:
        "Envia 1 ou 2 mídias da biblioteca (ex.: 1 áudio + 1 vídeo) que respondem à dúvida atual do lead. Use media_ids (array) com 1 ou 2 UUIDs DIFERENTES da lista [MÍDIAS DISPONÍVEIS]. Combine áudio+vídeo SOMENTE quando ambos esclarecem a MESMA dúvida e não foram enviados antes. Nunca repita kind (não mande 2 áudios ou 2 vídeos juntos). Não invente IDs.",
      parameters: {
        type: "object",
        properties: {
          media_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 2,
            description: "1 ou 2 UUIDs (kinds diferentes) da lista [MÍDIAS DISPONÍVEIS]",
          },
          media_id: {
            type: "string",
            description: "(legado) Use media_ids. Se preencher, mande só este UUID.",
          },
          caption: { type: "string", description: "Legenda curta (1 linha) que acompanha a 1ª mídia" },
          next_phase: {
            type: "string",
            enum: ["abertura", "descoberta", "pitch", "objecao", "fechamento"],
          },
          score_delta: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description:
        "Pausa o bot e aciona o consultor humano. Use quando o lead pede humano, está irritado, é high-value confuso, ou a IA não tem confiança.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          urgency: { type: "string", enum: ["baixa", "media", "alta"] },
        },
        required: ["reason", "urgency"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_followup",
      description:
        "Agenda um follow-up automático em N horas. Use quando o lead diz 'depois eu vejo', 'me chama amanhã', ou abandonou meio caminho.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "number" },
          followup_message_hint: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["hours", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "advance_to_closing",
      description:
        "Sinais de compra detectados. Pede a foto da conta de luz e inicia coleta de documentos.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Mensagem de transição (ex: pedir foto da conta)" },
          reasoning: { type: "string" },
        },
        required: ["message", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_lost",
      description: "Marca o lead como perdido. Use só com sinal claro de rejeição ou fora do perfil.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_for_name",
      description: "Pergunta o nome do lead de forma natural. Use quando ainda não houver 'Nome confiável' no contexto e a conversa estiver em descoberta/pitch.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Pergunta natural pedindo o nome" },
          reasoning: { type: "string" },
        },
        required: ["message", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_field",
      description:
        "Quando o lead REVELAR um dado estruturado (nome, valor da conta, dor), grave no cadastro. NÃO existe campo cidade nem distribuidora — esses dados vêm AUTOMATICAMENTE do OCR da conta de luz. Use APENAS quando você tem certeza do dado dito pelo lead nesta mensagem.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["name", "electricity_bill_value", "pain_point"],
          },
          value: { type: "string", description: "Valor exato a salvar (texto ou número como string)" },
          followup_message: { type: "string", description: "Resposta curta após salvar (acusa recebimento + próxima pergunta)" },
          next_phase: {
            type: "string",
            enum: ["abertura", "descoberta", "pitch", "objecao", "fechamento"],
          },
          reasoning: { type: "string" },
        },
        required: ["field", "value", "followup_message", "next_phase", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_and_handoff",
      description:
        "USE quando a conta JÁ foi recebida (OCR done) e os dados estão prontos. Confirma os dados em UMA frase e dispara handoff humano de uma vez. Substitui o fluxo confirmar+aguardar+handoff em 2 turnos.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Frase única confirmando titular, distribuidora, valor e dizendo que vai conectar para finalizar.",
          },
          reasoning: { type: "string" },
        },
        required: ["message", "reasoning"],
      },
    },
  },
];

function systemPrompt(personaName: string, tone: string, custom?: string, knowledgeBlock?: string) {
  const faqSection = knowledgeBlock && knowledgeBlock.trim()
    ? `\n\n═══════════════════════════════════════════\nFAQ OFICIAL — RESPOSTAS APROVADAS (use TEXTUALMENTE)\n═══════════════════════════════════════════\nUse APENAS o conteúdo abaixo para responder dúvidas factuais (preço, prazo, fidelidade, instalação, app, distribuidora, segurança, etc.). NÃO invente nada que não esteja aqui. Se a pergunta não tem resposta clara abaixo, use request_handoff.\n\n${knowledgeBlock}\n`
    : "";
  return `Você é ${personaName}, da equipe da iGreen Energy. Conversa com o cliente pelo WhatsApp pessoal — como uma pessoa de verdade, não como um robô.${faqSection}

═══════════════════════════════════════════
QUEM VOCÊ É (LEI ABSOLUTA)
═══════════════════════════════════════════
Você é um SER HUMANO conversando no WhatsApp. Vendedora consultiva da iGreen Energy. NÃO é IA, NÃO é assistente virtual, NÃO é bot. Se alguém perguntar "você é robô?", responde leve e desconversa: "kkk não, sou da equipe aqui mesmo. Por que, achei estranho?".

NUNCA, em hipótese nenhuma, diga ou insinue: "sou um assistente", "sou IA", "como modelo de linguagem", "fui programada", "estou aqui pra te ajudar" (frase de bot), "atendimento digital", "assistente virtual".

═══════════════════════════════════════════
TOM — 100% HUMANO BRASILEIRO
═══════════════════════════════════════════
- Fala natural, descontraída, mas profissional. Tipo a vendedora boa que vira amiga do cliente.
- Frases CURTAS (WhatsApp, no máximo 2-3 linhas por mensagem).
- 1 emoji por mensagem no MÁXIMO (💚 ☀️ 📸 ✨ 👍 🙌 — sem exagero, sem cascata).
- Pode usar "kkk", "rs", "haha" QUANDO o lead estiver informal/brincando. Se ele for formal, você é mais formal também — ESPELHA o registro dele.
- Pode usar gírias leves naturais ("bora", "tranquilo", "boa", "fechou", "show", "ó"). Nada forçado.
- Usa o primeiro nome do lead com naturalidade — 1x a cada 2-3 mensagens, não martela. NUNCA inventa nome.
- Pontuação correta. "você" (não "vc" salvo se o lead usar primeiro).
- ACUSE RECEBIMENTO antes de avançar — parafraseie em 3-6 palavras o que ele disse e SÓ ENTÃO faça a próxima pergunta.
- UMA pergunta por mensagem, no máximo.

PROIBIDO:
- Soar robótica: "como posso ajudar?", "estou à disposição", "fico à disposição", "em que posso ser útil"
- Listas com bullets/hífens/numeração no WhatsApp — texto corrido sempre.
- Repetir frase já enviada nas últimas 5 mensagens — sempre reformule.
- Pedir desculpas sem motivo ("desculpa incomodar").
- Bajulação vazia: "que delícia!", "amei!", "que gracinha!".

═══════════════════════════════════════════
NOME DO LEAD — REGRA CRÍTICA
═══════════════════════════════════════════
- Use SEMPRE o nome MAIS RECENTE que o lead disse. Se [Contexto] mostra "Pedro" mas na ÚLTIMA mensagem ele escreveu "me chamo Larissa" / "eu sou a Larissa" / "meu nome é Larissa" → o nome dele é LARISSA. Esquece o anterior, registra o novo via update_customer_field(name="Larissa") e usa o novo a partir de agora.
- Se [Contexto] traz "Nome confiável: X", pode usar X. Se traz "DESCONHECIDO", NÃO chame por nome — pergunta de forma natural ("como posso te chamar?") só se ainda fizer sentido.

═══════════════════════════════════════════
CONHECIMENTO IGREEN (use natural na conversa)
═══════════════════════════════════════════
• Empresa de Uberlândia/MG, regulamentada pela ANEEL, +600 mil clientes, RA1000 no Reclame Aqui.
• Desconto de 8% a 20% na conta de luz (varia por estado/distribuidora).
• Como funciona: a conta da distribuidora (CPFL, Enel, Cemig, Equatorial...) continua chegando NORMAL no nome do cliente. A iGreen abate parte via crédito de energia solar de usinas próprias. O cliente recebe TAMBÉM uma fatura da iGreen DENTRO do app iGreen Energy (Play Store / App Store) — é por lá que acompanha tudo.
• Sem obra, sem placa, sem trocar fiação, sem instalação, sem fidelidade, sem multa, sem mensalidade, sem taxa de adesão. Mesma distribuidora.
• BÔNUS Conexão Club: todo cliente ganha acesso GRATUITO a desconto em farmácia (Droga Raia, Drogasil, Pacheco até 70%), consultas, exames, óticas, pet shop, lazer. Mencione como CEREJA NO BOLO, não como pitch principal.

═══════════════════════════════════════════
COMO VOCÊ VENDE (estratégia progressiva)
═══════════════════════════════════════════
1. AQUECE — pergunta o nome (se não souber) e quanto vem na conta. Demonstra interesse real.
2. QUANTIFICA — com o valor em mãos, calcula a economia (≈20% sobre o valor) e entrega o número de cara: "Olha, com R$ X dá pra economizar uns R$ Y todo mês 💚".
3. EMPILHA VALOR — quando sentir abertura, joga o iGreen Club como bônus ("e ainda tem desconto em farmácia, mercado..."), nunca como pressão.
4. PEDE A CONTA — "pra eu confirmar tua distribuidora e travar o número certinho, me manda uma foto da última conta de luz aí 📸".
5. SE O LEAD RECUSAR A FOTO — aceita seguir só com o valor. Pode insistir UMA vez leve ("a foto trava o valor exato, mas se preferir seguimos só com a média mesmo, sem stress").
6. SÓ DEPOIS pede o documento — "agora pra fechar o cadastro preciso só de uma foto do seu RG ou CNH 📄".
7. QUEBRA OBJEÇÃO com empatia, nunca com script.

═══════════════════════════════════════════
QUANDO O LEAD ENROLA / DIZ "DEPOIS"
═══════════════════════════════════════════
Não force. Reage humano: "tranquilo! qualquer coisa me chama aqui 🙌" ou "sem stress, fica à vontade — só não esquece que enquanto isso tá pagando a mais, viu kkk".
NÃO use a tool pause_bot a menos que o lead seja agressivo ou peça humano explicitamente. Se ele disser "depois eu vejo", responde leve e segue na próxima mensagem dele normalmente.

═══════════════════════════════════════════
MATRIZ DE MÍDIA POR INTENÇÃO
═══════════════════════════════════════════
Cada mídia em [MÍDIAS DISPONÍVEIS] tem step_tags + intent_tags. Para dúvidas densas/emocionais ("é golpe?", "tô com medo", "minha mãe disse..."), prefira ÁUDIO da biblioteca (acolhe melhor). Para "como funciona" detalhado, VÍDEO. Cada mídia é enviada NO MÁXIMO 1× por lead — se a ideal já foi, responde por TEXTO.

REGRAS DURAS:
- NUNCA mídia depois de "CONTA JÁ RECEBIDA E ANALISADA".
- NUNCA cite media_id que não está em [MÍDIAS DISPONÍVEIS].
- NUNCA prometa "vou mandar áudio/vídeo" sem chamar send_media na mesma decisão.

═══════════════════════════════════════════
PÓS-CONTA → HANDOFF
═══════════════════════════════════════════
Quando [Contexto] indicar "CONTA JÁ RECEBIDA E ANALISADA":
1. Confirme em UMA mensagem curta os dados (titular + valor + distribuidora) e pergunta "Tá tudo certinho pra eu seguir com o cadastro?".
2. Quando o lead confirmar, use IMEDIATAMENTE request_handoff(urgency="alta", reason="lead_pronto_cadastro").
3. PROIBIDO continuar enviando vídeo/áudio depois que a conta foi recebida.

═══════════════════════════════════════════
REGRAS CRÍTICAS
═══════════════════════════════════════════
- Use SEMPRE uma das tools.
- Se [Contexto] indicar "CONTA JÁ RECEBIDA E ANALISADA": JAMAIS peça a foto da conta de novo.
- Se o lead pedir humano: request_handoff.
- NUNCA invente preço, prazo, percentual, comissão, lei. Se não souber, "deixa eu confirmar com a equipe e te volto" + request_handoff.
- NUNCA chame ask_for_name se já tem nome confiável.
- score_delta: +20 sinal de compra/foto • +10 valor revelado • +5 engajamento • -10 objeção forte • -20 desistência.

${custom ? `\n═══════════════════════════════════════════\nINSTRUÇÕES ADICIONAIS DO CONSULTOR\n═══════════════════════════════════════════\n${custom}` : ""}`;
}

function stripEmojis(s: string): string {
  return (s || "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Palavras que NÃO são nomes próprios — não devem ser removidas como vocativo.
const NON_NAME_WORDS = new Set([
  "tudo", "bem", "bom", "boa", "tarde", "noite", "dia", "como", "vai", "está", "esta",
  "olá", "ola", "oi", "opa", "obrigado", "obrigada", "certo", "claro", "então", "entao",
  "para", "pra", "por", "que", "qual", "quem", "onde", "quando", "sim", "não", "nao",
  "consultora", "consultor", "vendedora", "vendedor", "atendente",
]);

function stripUntrustedVocative(message: string, trustedFirstName: string | null): string {
  if (!message) return message;
  // Remove "Olá NOME," / "Oi NOME!" se NOME não for o confiável E parecer realmente um nome próprio.
  const re = /^(ol[aá]|oi|opa|bom dia|boa tarde|boa noite)[,!\s]+([A-ZÀ-Ý][a-zà-ÿ]{1,20})([,!.\s])/i;
  const m = message.match(re);
  if (m) {
    const used = m[2];
    // Não remover se for palavra de gramática (Tudo, Bem, Como, etc.)
    if (NON_NAME_WORDS.has(used.toLowerCase())) return message;
    if (!trustedFirstName || used.toLowerCase() !== trustedFirstName.toLowerCase()) {
      return message.replace(re, "$1$3");
    }
  }
  return message;
}

function stripRepeatedGreeting(message: string, hasPriorOutbound: boolean): string {
  if (!message || !hasPriorOutbound) return message;
  // Após a primeira mensagem, remover saudações redundantes no início.
  return message
    .replace(/^\s*(ol[aá]|oi|opa|bom dia|boa tarde|boa noite)[,!.\s]+/i, "")
    .replace(/^\s*(tudo bem\??|tudo bom\??|como vai\??)[,!.\s]+/i, "")
    .trim();
}

function stripDuplicateOpener(message: string, lastAssistantMsg: string | null): string {
  if (!message || !lastAssistantMsg) return message;
  // Se as duas começam com a mesma palavra de abertura comum, remove a abertura.
  const openerRe = /^\s*(entendo|compreendo|perfeito|ótimo|otimo|claro|certo|legal|beleza|faz sentido|saquei|justo)[,!.\s]+/i;
  const a = message.match(openerRe);
  const b = lastAssistantMsg.match(openerRe);
  if (a && b && a[1].toLowerCase() === b[1].toLowerCase()) {
    return message.replace(openerRe, "").trim();
  }
  return message;
}

function sanitizeHumanMessage(
  message: string,
  phase: string,
  userInput: string,
  trustedFirstName: string | null,
  hasPriorOutbound: boolean = false,
  lastAssistantMsg: string | null = null,
): string {
  let out = (message || "").trim();
  if (!out) {
    if (phase === "abertura") return trustedFirstName ? `${trustedFirstName}, quanto você está pagando em média na sua conta de luz?` : "Quanto você está pagando em média na sua conta de luz?";
    if (phase === "descoberta") return "Quanto vem em média a sua conta de luz?";
    if (phase === "pitch") return "Posso te mostrar exatamente quanto você economizaria?";
    if (phase === "objecao") return "Faz sentido. O que especificamente está pesando na decisão?";
    return "Vamos seguir com seu cadastro. Me confirma se podemos avançar?";
  }
  // NÃO removemos emojis nem "kkk/rs" — o tom humano permite (com moderação).
  out = stripUntrustedVocative(out, trustedFirstName);
  out = stripRepeatedGreeting(out, hasPriorOutbound);
  out = stripDuplicateOpener(out, lastAssistantMsg);
  // Limpa apenas abreviações severas que destoam (não toca em "kkk"/"rs"/emojis)
  out = out
    .replace(/\boii+e?\b/gi, "Oi")
    .replace(/\bvc\b/gi, "você")
    .replace(/\bblz\b/gi, "beleza")
    .replace(/\b(amorzinho|fofinho|fofinha|queridinho|queridinha)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Capitaliza primeira letra se ficou minúscula após cortes
  if (out && /^[a-zà-ÿ]/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  // Comprimento máximo
  if (out.length > 400) out = out.slice(0, 397) + "...";
  return out;
}

async function loadContext(supabase: any, customerId: string) {
  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, consultant_id, name, name_source, phone_whatsapp, distribuidora, address_city, address_state, address_street, electricity_bill_value, electricity_bill_photo_url, ocr_done, bill_requested_at, numero_instalacao, pain_point, sales_phase, qualification_score, lead_source, customer_referred_by_name, conversation_summary, summary_updated_at, bot_paused, bot_paused_until, assigned_human_id",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) return null;

  // Se há resumo recente (<24h) usamos só as últimas 12 mensagens. Senão, 60.
  const summaryFresh = customer.conversation_summary
    && customer.summary_updated_at
    && (Date.now() - new Date(customer.summary_updated_at).getTime()) < 24 * 3600 * 1000;
  const histLimit = summaryFresh ? 12 : 60;

  const { data: history } = await supabase
    .from("conversations")
    .select("message_direction, message_text, message_type, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(histLimit);

  const { data: agentCfg } = await supabase
    .from("ai_agent_config")
    .select("persona_name, tone, system_prompt")
    .or(`consultant_id.eq.${customer.consultant_id},consultant_id.is.null`)
    .order("consultant_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Memória longa — fatos persistentes do lead (top 15 por confiança/recência)
  const { data: memoryFacts } = await supabase
    .from("customer_memory_active")
    .select("category, key, value, confidence, last_confirmed_at, source")
    .eq("customer_id", customerId)
    .order("confidence", { ascending: false })
    .order("last_confirmed_at", { ascending: false })
    .limit(15);

  // FAQ oficial — respostas aprovadas: seções do consultor + globais (sem inventar)
  const { data: knowledge } = await supabase
    .from("ai_knowledge_sections")
    .select("title, content")
    .eq("is_active", true)
    .or(`consultant_id.is.null,consultant_id.eq.${customer.consultant_id}`)
    .order("consultant_id", { ascending: false, nullsFirst: true }) // consultor-específico primeiro
    .order("position");
  const knowledgeBlock = (knowledge || [])
    .map((k: any) => `## ${k.title}\n${k.content}`)
    .join("\n\n")
    .slice(0, 6000);

  return {
    customer,
    history: (history || []).reverse(),
    persona: agentCfg?.persona_name || "Rafael",
    tone: agentCfg?.tone || "humano, breve, cordial",
    customPrompt: agentCfg?.system_prompt || "",
    summaryFresh,
    memoryFacts: memoryFacts || [],
    knowledgeBlock,
  };
}

// ---------- INTENT-FIRST: detecta intenção determinística ANTES do LLM ----------
// Para sinais claros (cadastrar/humano/desistir) podemos pular o LLM totalmente.
function detectIntent(text: string): string | null {
  const ui = (text || "").toLowerCase();
  if (/\b(cadastr|quero (entrar|participar|aderir|economizar|fazer)|fazer (adesao|adesão|cadastro)|me cadastra|vamos l[aá]|bora|aceito|topo|fechado|pode (cadastrar|prosseguir|seguir)|j[aá] quero)\b/i.test(ui)) return "cadastrar";
  if (/\b(humano|atendente|pessoa|operador|consultor real|fala com (algu[eé]m|gente|pessoa)|chama (o|a) (consultor|atendente))\b/i.test(ui)) return "humano";
  if (/\b(parar|cancelar|n[aã]o quero|sem interesse|desisto|me deixa|para de|tira meu|nao tenho interesse|n[aã]o me incomod|n[aã]o gostei)\b/i.test(ui)) return "desistir";
  if (/\b(golpe|fraude|seguro\?|confi[aá]vel|enganaç[aã]o|verdade)\b/i.test(ui)) return "objecao_confianca";
  if (/\b(fidelidade|multa|trocar|mudar de empresa|distribuidora vai)\b/i.test(ui)) return "objecao_contrato";
  if (/\b(custo|caro|gratuito|de gra[çc]a|paga|mensalidade|taxa)\b/i.test(ui)) return "objecao_custo";
  if (/\b(quanto|valor|economia|pre[çc]o|desconto|porcentagem)\b/i.test(ui)) return "interesse_valor";
  if (/\b(como funciona|me explica|n[aã]o entendi|o que [eé]|quem [eé])\b/i.test(ui)) return "informacao";
  return null;
}

// ---------- GUARDRAIL: bloqueia números inventados ----------
// Apenas valores derivados da conta são permitidos. Tudo mais vira texto neutro.
function sanitizeNumbers(message: string, billValue: number): string {
  if (!message) return message;
  const allowedExact = new Set<string>(["2017", "600", "20", "12", "70"]);
  // Permite "R$ <valor>" se for ~ bill, bill*0.12 ou bill*0.12*12
  const targets = billValue > 0
    ? [Math.round(billValue), Math.round(billValue * 0.12), Math.round(billValue * 0.12 * 12)]
    : [];
  return message.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+)/gi, (full, num) => {
    const n = Number(String(num).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) return full;
    if (targets.some((t) => Math.abs(t - n) <= Math.max(2, t * 0.05))) return full;
    return ""; // remove números fora da whitelist
  }).replace(/\b(\d{1,3})\s?%/g, (full, num) => {
    if (allowedExact.has(String(num))) return full;
    const n = Number(num);
    if (n >= 8 && n <= 22) return full; // faixa de desconto plausível
    return "";
  }).replace(/\s{2,}/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const body = await req.json();
    const { customer_id, user_input, mode = "reply" } = body;
    if (!customer_id || (!user_input && mode !== "rescue")) {
      return new Response(JSON.stringify({ error: "customer_id and user_input required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 🔒 IDOR guard (REQ 5): autentica o chamador (JWT ou segredo de serviço) e
    // verifica posse do recurso ANTES de qualquer leitura/gravação/efeito colateral.
    // Chamadas internas (ex.: evolution-webhook → ai-agent-router → ai-sales-agent)
    // usam x-service-secret e resolvem como modo "service" (dispensa posse).
    const caller = await resolveCaller(req, supabase);
    if (caller instanceof Response) return caller;
    const deny = await assertOwnership(caller, { customerId: customer_id }, supabase);
    if (deny) return deny;

    const ctx = await loadContext(supabase, customer_id);
    if (!ctx) {
      return new Response(JSON.stringify({ error: "customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { customer, history, persona, tone, customPrompt, summaryFresh, memoryFacts, knowledgeBlock } = ctx;

    // 🔇 Humano assumiu → IA não responde. Para qualquer modo (reply, rescue, etc.).
    if (isCustomerPausedByHuman(customer as any)) {
      console.log(`🔇 ai-sales-agent: bot pausado para customer ${customer.id} — abortando`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "bot_paused_by_human" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 🛑 IA globalmente desligada pelo consultor.
    if (await isConsultantAIDisabled(supabase, (customer as any).consultant_id)) {
      console.log(`🛑 ai-sales-agent: IA do consultor ${(customer as any).consultant_id} desligada globalmente`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "global_ai_disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const phase = customer.sales_phase || "abertura";

    // ---------- INTENT-FIRST short-circuit (sem LLM) ----------
    // "humano" → handoff direto. "desistir" → mark_lost. Latência ~50ms, custo zero.
    const earlyIntent = mode === "reply" ? detectIntent(user_input || "") : null;
    if (earlyIntent === "humano") {
      await supabase.from("customers").update({
        bot_paused: true,
        bot_paused_reason: "intent_humano: lead pediu atendimento humano",
        bot_paused_at: new Date().toISOString(),
      }).eq("id", customer_id);
      await supabase.from("ai_decisions").insert({
        customer_id, consultant_id: customer.consultant_id, phase,
        tool_called: "request_handoff", reasoning: "early_intent_humano",
        user_input, ai_output: { reason: "lead pediu humano", urgency: "alta" },
        latency_ms: Date.now() - t0, intent_detected: "humano",
      });
      return new Response(JSON.stringify({
        decision: { tool: "request_handoff", args: { reason: "lead pediu humano", urgency: "alta" } },
        phase, latency_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (earlyIntent === "desistir") {
      await supabase.from("customers").update({
        sales_phase: "perdido", bot_paused: true,
        bot_paused_reason: "intent_desistir: lead disse que não quer",
      }).eq("id", customer_id);
      await supabase.from("ai_decisions").insert({
        customer_id, consultant_id: customer.consultant_id, phase,
        tool_called: "mark_lost", reasoning: "early_intent_desistir",
        user_input, ai_output: { reason: "lead recusou explicitamente" },
        latency_ms: Date.now() - t0, intent_detected: "desistir",
      });
      return new Response(JSON.stringify({
        decision: { tool: "mark_lost", args: { reason: "lead recusou explicitamente" } },
        phase, latency_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Profile inference for media filtering
    const bill = Number(customer.electricity_bill_value || 0);
    const profileTags: string[] = ["any", "todos"];
    if (bill > 500) profileTags.push("conta_alta");
    else if (bill >= 200) profileTags.push("conta_media");
    else if (bill > 0) profileTags.push("conta_baixa");

    // Cadence: last 4 outbound entries — count consecutive media to enforce anti-spam
    const lastOut = history.filter((h: any) => h.message_direction !== "inbound").slice(-4);
    const recentMediaCount = lastOut.filter((h: any) =>
      ["audio", "video", "image"].includes((h.message_type || "").toLowerCase()),
    ).length;
    const lastInbound = history.filter((h: any) => h.message_direction === "inbound").slice(-1)[0];
    const lastInboundKind = (lastInbound?.message_type || "text").toLowerCase();

    // Load candidate media for this phase + profile (consultant own + public)
    // Inclui também rows com step_tags vazias OU com slot_key (mídias-slot ex.: boas_vindas).
    const { data: candidatesRaw } = await supabase
      .from("ai_media_library")
      .select("id, kind, label, url, step_tags, intent_tags, priority, duration_sec, is_primary_explainer, slot_key")
      .eq("active", true)
      .or(`consultant_id.eq.${customer.consultant_id},is_public.eq.true`)
      .order("priority", { ascending: false })
      .limit(40);
    const candidates = (candidatesRaw || []).filter((m: any) => {
      const tags = Array.isArray(m.step_tags) ? m.step_tags : [];
      // Aceita: tem slot_key (mídia deterministica) OU step vazio OU bate na fase/any.
      if (m.slot_key) return true;
      if (tags.length === 0) return true;
      return tags.includes(phase) || tags.includes("any");
    });

    // intent_tags agora descrevem a DÚVIDA que a mídia responde (ex.: "e_golpe", "tem_custo").
    // O matching com a dúvida do lead é feito pela própria IA via prompt — não filtramos aqui.
    const eligibleMedia = candidates || [];

    // Conta só conta como "recebida" se OCR concluído E nome veio de fonte confiável.
    // Sem isso, o LLM ficava preso confirmando dados de um lead anterior reaproveitado.
    const nameSourceTrusted = ["ocr", "self_introduced", "manual"].includes(
      String(customer.name_source || ""),
    );
    const billAlreadyReceivedEarly =
      !!customer.electricity_bill_photo_url && !!customer.ocr_done && nameSourceTrusted;

    // Cooldown 1× por vida: mídia enviada uma vez para este lead nunca aparece de novo.
    const { data: recentMediaSent } = await supabase
      .from("ai_decisions")
      .select("media_sent_id")
      .eq("customer_id", customer_id)
      .not("media_sent_id", "is", null)
      .limit(500);
    const sentMediaIds = new Set((recentMediaSent || []).map((r: any) => r.media_sent_id));
    const freshMedia = eligibleMedia.filter((m: any) => !sentMediaIds.has(m.id));

    // ---------- DETERMINISTIC SHORT-CIRCUIT: áudio de boas-vindas ----------
    // Se é a 1ª resposta da IA para esse lead E existe áudio com slot_key
    // 'boas_vindas' / 'first_response' / 'first_touch' ainda não enviado,
    // dispara direto sem depender do LLM.
    //
    // Sprint 3: gate via `_shared/bot/orchestrator-gate` — consultor com
    // bot_flows.is_active=true tem o motor custom como fonte única; logamos
    // a decisão de pular em ai_decisions para observabilidade no AIAuditPanel.
    const priorOutboundEarly = history.filter((h: any) => h.message_direction !== "inbound");
    const isFirstReply = priorOutboundEarly.length === 0 && mode === "reply";
    const FIRST_SLOTS = new Set(["boas_vindas", "first_response", "first_touch", "primeira_resposta"]);
    const skipShortCircuit = await shouldSkipShortCircuit(
      supabase,
      customer.consultant_id,
      mode,
    );
    if (isFirstReply && !billAlreadyReceivedEarly && !skipShortCircuit) {
      const firstAudio = freshMedia
        .filter((m: any) => m.kind === "audio" && m.slot_key && FIRST_SLOTS.has(m.slot_key))
        .sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))[0];
      if (firstAudio?.url) {
        await supabase.from("ai_decisions").insert({
          customer_id, consultant_id: customer.consultant_id, phase,
          tool_called: "send_media", reasoning: `deterministic_first_audio:${firstAudio.slot_key}`,
          user_input, ai_output: { media_ids: [firstAudio.id], slot_key: firstAudio.slot_key },
          media_sent_id: firstAudio.id, latency_ms: Date.now() - t0,
        });
        const mediaPayload = { id: firstAudio.id, url: firstAudio.url, kind: firstAudio.kind, label: firstAudio.label };
        return new Response(JSON.stringify({
          decision: {
            tool: "send_media",
            args: { media_ids: [firstAudio.id], caption: "", next_phase: phase, reasoning: `deterministic_first_audio:${firstAudio.slot_key}` },
          },
          media: mediaPayload,
          medias: [mediaPayload],
          phase, latency_ms: Date.now() - t0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (isFirstReply && skipShortCircuit) {
      // Observabilidade: registra o skip para o AIAuditPanel mostrar por que o
      // motor custom assumiu (em vez do atalho deterministic_first_audio).
      try {
        await supabase.from("ai_decisions").insert({
          customer_id, consultant_id: customer.consultant_id, phase,
          tool_called: "skip", reasoning: "custom_flow_active:short_circuit_bypassed",
          user_input, ai_output: { mode, reason: "consultant_has_active_bot_flow" },
          latency_ms: Date.now() - t0, suppressed: true,
        });
      } catch (_) { /* best-effort, não bloqueia */ }
    }


    const formatTags = (arr: any) => {
      const a = Array.isArray(arr) ? arr.filter((x: any) => x && x !== "any") : [];
      return a.length ? a.join(",") : "—";
    };

    const mediaListLine = billAlreadyReceivedEarly
      ? `\n[MÍDIAS DISPONÍVEIS]\nNENHUMA — a conta já foi recebida. Confirme os dados em send_text e em seguida use request_handoff. PROIBIDO send_media nesta etapa.`
      : freshMedia.length
      ? `\n[MÍDIAS DISPONÍVEIS para fase ${phase}] (cada uma só pode ser enviada 1× na vida do lead)\n` +
        freshMedia
          .map((m: any, i: number) =>
            `${i + 1}. id=${m.id} | ${m.kind} | "${m.label}"${m.duration_sec ? ` (${m.duration_sec}s)` : ""} | etapa=[${formatTags(m.step_tags)}] | intencao=[${formatTags(m.intent_tags)}]`
          )
          .join("\n") +
        `\nUse send_media com media_ids=[id]. Combine 1 áudio + 1 vídeo (kinds DIFERENTES) no mesmo send_media só quando ambos casam com a MESMA intenção da dúvida atual.${
          sentMediaIds.size ? ` (${sentMediaIds.size} mídia(s) já enviada(s) anteriormente foram ocultadas — NÃO repita.)` : ""
        }`
      : `\n[MÍDIAS DISPONÍVEIS]\nNenhuma nova para esta fase (todas já enviadas). Use send_text.`;

    const cadenceLine =
      `\n[CADÊNCIA]\n` +
      `- Última msg do lead foi do tipo: ${lastInboundKind}\n` +
      (lastInboundKind === "audio"
        ? `- Lead mandou áudio: prefira responder com áudio também (espelho), se houver áudio compatível em [MÍDIAS DISPONÍVEIS].\n`
        : ``) +
      (lastInbound && (lastInbound.message_text || "").length < 20
        ? `- Lead foi breve: responda breve também.\n`
        : ``);

    const billNum = Number(customer.electricity_bill_value || 0);
    const billCalcLine = billNum > 0
      ? `\n[CÁLCULO PRONTO PRA USAR NO PITCH]\nConta R$ ${billNum.toFixed(0)} → economia ~R$ ${(billNum * 0.20).toFixed(0)}/mês → R$ ${(billNum * 0.20 * 12).toFixed(0)}/ano.\n`
      : "";

    // Nome só é confiável se a fonte for OCR ou auto-apresentação ("meu nome é X").
    // Nunca usar pushName/JID/herdado de import.
    const isTrustworthyName = (raw?: string | null): boolean => {
      if (!raw) return false;
      const n = raw.trim();
      if (n.length < 2 || n.length > 30) return false;
      if (/\d/.test(n)) return false;
      if (/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(n)) return false;
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(n)) return false;
      const blacklist = /\b(iphone|galaxy|xiaomi|motorola|samsung|cliente|suporte|atendimento|whatsapp|user|test|teste|admin|null|undefined|desconhecido|none|n\/a)\b/i;
      if (blacklist.test(n)) return false;
      return true;
    };
    const trustedSources = new Set(["ocr", "self_introduced", "manual"]);
    const nameSourceOk = trustedSources.has(String(customer.name_source || ""));
    const firstName = (nameSourceOk && isTrustworthyName(customer.name))
      ? (customer.name as string).trim().split(/\s+/)[0]
      : null;

    // Conta só conta como "recebida" para fim de bloqueio se OCR + nome confiável.
    const billAlreadyReceived = billAlreadyReceivedEarly;
    const ocrDone = !!customer.ocr_done;
    const billRequestedRecently = customer.bill_requested_at
      && (Date.now() - new Date(customer.bill_requested_at).getTime()) < 60 * 60 * 1000;

    const billStatusBlock = billAlreadyReceived
      ? `\n[CONTA JÁ RECEBIDA E ANALISADA]\n` +
        `- Foto/PDF da conta: já está no sistema (NÃO PEÇA DE NOVO).\n` +
        `- OCR processado: ${ocrDone ? "sim" : "em andamento"}\n` +
        `- Titular OCR: ${customer.name || "?"}\n` +
        `- Distribuidora OCR: ${customer.distribuidora || "?"}\n` +
        `- Instalação: ${customer.numero_instalacao || "?"}\n` +
        `- Valor: ${billNum > 0 ? `R$ ${billNum}` : "?"}\n` +
        `Use estes dados para confirmar com o cliente e seguir para o cadastro.\n`
      : (billRequestedRecently
          ? `\n[CONTA JÁ FOI SOLICITADA HÁ POUCOS MINUTOS — não repita o pedido, apenas reforce gentilmente]\n`
          : "");

    // Construir [JÁ SABEMOS] / [FALTA DESCOBRIR] dinamicamente — evita repergunta.
    // REGRA: a IA SÓ pergunta valor da conta. Distribuidora, cidade, endereço, titular vêm do OCR.
    const known: string[] = [];
    const missing: string[] = [];
    if (firstName) known.push(`Nome: ${firstName}`);
    if (customer.distribuidora) known.push(`Distribuidora: ${customer.distribuidora}`);
    if (billNum > 0) known.push(`Valor da conta: R$ ${billNum}`);
    else missing.push("valor médio da conta de luz");
    if (customer.address_city) known.push(`Cidade: ${customer.address_city}/${customer.address_state || ""}`.trim());
    if (customer.pain_point) known.push(`Dor: ${customer.pain_point}`);

    // Quantas vezes a IA já perguntou o valor da conta? Se ≥2, parar de perguntar
    // e pedir a foto direto (evita loop irritante).
    const billAskCount = history.filter(
      (h: any) =>
        h.message_direction !== "inbound" &&
        /(valor|quanto.*paga|quanto.*vem|m[eé]dia).*(conta|luz)|conta.*(valor|m[eé]dia)/i.test(
          String(h.message_text || ""),
        ),
    ).length;
    const stopAskingBill = billNum === 0 && billAskCount >= 2;

    const knownBlock = known.length
      ? `\n[JÁ SABEMOS — NÃO pergunte de novo, USE livremente]\n- ${known.join("\n- ")}\n`
      : "";
    const missingBlock = stopAskingBill
      ? `\n[FALTA DESCOBRIR]\n- O lead JÁ foi perguntado 2x sobre o valor da conta e não respondeu. PARE DE PERGUNTAR. Peça a FOTO da conta de luz: "Me manda uma foto da sua conta de luz que eu já vejo tudo por ali, fica mais fácil pra você 💚".\n`
      : (missing.length && !billAlreadyReceived)
      ? `\n[FALTA DESCOBRIR — pergunte UM por vez nesta ordem]\n- ${missing.join("\n- ")}\n`
      : (!billAlreadyReceived
          ? `\n[FALTA DESCOBRIR]\n- Nada essencial. Faça o pitch com o cálculo OU peça a foto da conta para fechar.\n`
          : "");

    const contextLine =
      `[Contexto do lead]\n` +
      (firstName
        ? ``
        : `Nome: DESCONHECIDO — NÃO chame por nome. Use saudação neutra. Se a conversa avançar sem nome, considere ask_for_name (mas NÃO se a foto da conta já foi pedida/recebida).\n`) +
      `Score atual: ${customer.qualification_score ?? 0}/100\n` +
      `Fase atual: ${phase}\n` +
      `Origem: ${customer.lead_source?.utm_source || "organico"}\n` +
      (customer.customer_referred_by_name
        ? `Indicado por: ${customer.customer_referred_by_name}\n`
        : "") +
      knownBlock +
      missingBlock +
      billStatusBlock +
      billCalcLine +
      mediaListLine +
      cadenceLine;

    // Few-shot só rola em fases que valem a pena (objeção/fechamento) — economiza 2 queries por chamada
    const shouldLoadFewshot = phase === "objecao" || phase === "fechamento";
    let fewShotLine = "";
    let negShotLine = "";
    if (shouldLoadFewshot) {
      const { data: positive } = await supabase
        .from("ai_decisions")
        .select("user_input, ai_output, tool_called")
        .eq("consultant_id", customer.consultant_id)
        .contains("feedback", { rating: "up" })
        .order("created_at", { ascending: false })
        .limit(5);
      fewShotLine = (positive || []).length
        ? `\n[EXEMPLOS APROVADOS PELO CONSULTOR]\n` +
          (positive || [])
            .map((p: any) => `Lead: "${(p.user_input || "").slice(0, 80)}" → ${p.tool_called}: "${(p.ai_output?.message || p.ai_output?.caption || "").slice(0, 80)}"`)
            .join("\n")
        : "";
      const { data: negative } = await supabase
        .from("ai_decisions")
        .select("user_input, ai_output, tool_called")
        .eq("consultant_id", customer.consultant_id)
        .contains("feedback", { rating: "down" })
        .order("created_at", { ascending: false })
        .limit(3);
      negShotLine = (negative || []).length
        ? `\n[NÃO FAZER ASSIM — exemplos reprovados pelo consultor]\n` +
          (negative || [])
            .map((p: any) => `Lead: "${(p.user_input || "").slice(0, 80)}" → ${p.tool_called}: "${(p.ai_output?.message || p.ai_output?.caption || "").slice(0, 80)}"`)
            .join("\n")
        : "";
    }

    // ---- Resumo da conversa (cacheado) substitui parte do histórico ----
    const summaryLine = (summaryFresh && customer.conversation_summary)
      ? `\n[RESUMO DA CONVERSA ATÉ AGORA]\n${customer.conversation_summary}\n(Use o resumo para contexto; as últimas mensagens cruas vêm depois.)\n`
      : "";

    // ---- Memória longa: fatos persistentes que sobrevivem entre sessões ----
    let memoryLine = "";
    if (memoryFacts && memoryFacts.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const f of memoryFacts) {
        const conf = f.confidence >= 0.8 ? "" : f.confidence >= 0.5 ? " (?)" : " (?? baixa confiança)";
        (grouped[f.category] ||= []).push(`${f.key}: ${f.value}${conf}`);
      }
      const blocks = Object.entries(grouped)
        .map(([cat, items]) => `• ${cat}: ${items.join("; ")}`)
        .join("\n");
      memoryLine = `\n[MEMÓRIA LONGA — fatos confirmados sobre este lead, NUNCA repergunte o que está aqui]\n${blocks}\n`;
    }

    // ---- Padrões aprendidos do feedback do consultor (👍/👎) ----
    let learnedLine = "";
    try {
      const intentForLookup = earlyIntent || (phase === "objecao" ? "objecao_custo" : null);
      if (intentForLookup) {
        const { data: pat } = await supabase
          .from("ai_learned_patterns")
          .select("good_examples, bad_examples")
          .eq("consultant_id", customer.consultant_id)
          .eq("intent", intentForLookup)
          .maybeSingle();
        if (pat) {
          const goods = (pat.good_examples || []).slice(0, 2)
            .map((g: any) => `+ "${(g.output || "").slice(0, 100)}"`).join("\n");
          const bads = (pat.bad_examples || []).slice(0, 1)
            .map((b: any) => `- "${(b.output || "").slice(0, 100)}"`).join("\n");
          if (goods || bads) {
            learnedLine = `\n[PADRÕES APRENDIDOS — intent=${intentForLookup}]\n${goods}\n${bads}\n`;
          }
        }
      }
    } catch (_) { /* best-effort */ }

    // ---- Construir contents no formato Gemini ----
    const sys = systemPrompt(persona, tone, customPrompt, knowledgeBlock) + summaryLine + memoryLine + learnedLine + fewShotLine + negShotLine + "\n\n" + contextLine;

    const contents: any[] = history.map((m: any) => ({
      role: m.message_direction === "inbound" ? "user" : "model",
      parts: [{ text: m.message_text || "(sem texto)" }],
    }));
    // Garante que começa em 'user' (Gemini exige)
    while (contents.length && contents[0].role !== "user") contents.shift();

    // Closer só dispara se temos OCR + nome confiável; senão cai no fluxo reply normal
    const closerReady = mode === "closer" && nameSourceTrusted && ocrDone;
    const effectiveMode = (mode === "closer" && !closerReady) ? "reply" : mode;

    if (effectiveMode === "rescue") {
      contents.push({
        role: "user",
        parts: [{ text: "[SISTEMA] Lead silenciou. Gere mensagem de resgate breve, sem cobrar, com gancho diferente do que já foi enviado." }],
      });
    } else if (effectiveMode === "closer") {
      contents.push({
        role: "user",
        parts: [{ text: `[SISTEMA] Conta recebida e OCR ok. Use IMEDIATAMENTE confirm_and_handoff confirmando ${customer.name || "titular"} / ${customer.distribuidora || "?"} / R$ ${billNum.toFixed(0)}.` }],
      });
    } else {
      contents.push({ role: "user", parts: [{ text: user_input }] });
    }
    if (!contents.length) contents.push({ role: "user", parts: [{ text: user_input || "Olá" }] });

    // Converte tools OpenAI -> Gemini functionDeclarations
    const geminiTools: GeminiTool[] = [{
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }];

    // Decide qual modelo usar — Pro só quando vale a latência extra
    const score = Number(customer.qualification_score ?? 0);
    const useProModel =
      effectiveMode === "closer" ||
      phase === "fechamento" ||
      score >= 70 ||
      billAlreadyReceivedEarly;
    const modelToUse = effectiveMode === "rescue"
      ? MODEL_RESCUE
      : (useProModel ? MODEL_DECISION : MODEL_DEFAULT);

    let aiResult;
    try {
      aiResult = await geminiGenerate({
        model: modelToUse,
        system: sys,
        contents,
        tools: geminiTools,
        toolChoice: { mode: "ANY" },
        temperature: 0.5,
        thinkingBudget: modelToUse === MODEL_DECISION ? 512 : 0,
        maxOutputTokens: 1200,
        fallbackModel: MODEL_FALLBACK,
        functionName: "ai-sales-agent",
        consultantId: customer.consultant_id,
        customerId: customer_id,
      });
    } catch (e) {
      console.error("[ai-sales-agent] gemini error:", e);
      return new Response(JSON.stringify({ error: String((e as Error).message) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolCallG = aiResult.toolCall;
    if (!toolCallG) {
      return new Response(
        JSON.stringify({
          decision: { tool: "send_text", args: { message: sanitizeHumanMessage(aiResult.text || "", phase, "", firstName), next_phase: phase, reasoning: "fallback_no_toolcall" } },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let tool = toolCallG.name;
    let args: any = toolCallG.args || {};

    // Modelo "1 principal" foi descontinuado em favor de seleção por intent_tags.
    // A IA escolhe a mídia compatível direto pela lista [MÍDIAS DISPONÍVEIS].
    // Normaliza media_id (legado) → media_ids (array novo).
    if (tool === "send_media") {
      if (!Array.isArray(args.media_ids) || args.media_ids.length === 0) {
        if (args.media_id) args.media_ids = [args.media_id];
      }
      // Dedup + máximo 2 + kinds diferentes (descarta o segundo se for mesmo kind)
      const ids = Array.from(new Set((args.media_ids || []).filter((x: any) => typeof x === "string")));
      const seenKinds = new Set<string>();
      const filtered: string[] = [];
      for (const id of ids) {
        const m = eligibleMedia.find((x: any) => x.id === id);
        if (!m) continue;
        if (seenKinds.has(m.kind)) continue;
        seenKinds.add(m.kind);
        filtered.push(id);
        if (filtered.length === 2) break;
      }
      args.media_ids = filtered;
    }

    // ---- OVERRIDE 2: ask_for_name é PROIBIDO. O áudio de boas-vindas já pede o nome. ----
    if (tool === "ask_for_name") {
      tool = "send_text";
      args = {
        message: customer.electricity_bill_photo_url || billRequestedRecently
          ? "Pode me mandar a foto da conta de luz quando puder? Por ela eu já confirmo todos os dados."
          : (args.message || "Me conta, sua conta de luz costuma vir em qual valor mais ou menos?"),
        next_phase: phase,
        reasoning: "ask_for_name bloqueado: nome é capturado pelo áudio de boas-vindas",
      };
    }

    const priorOutbound = history.filter((h: any) => h.message_direction !== "inbound");
    const hasPriorOutbound = priorOutbound.length > 0;
    const lastAssistantMsg = priorOutbound.slice(-1)[0]?.message_text || null;

    if (tool === "send_text" || tool === "advance_to_closing" || tool === "ask_for_name" || tool === "confirm_and_handoff") {
      args.message = sanitizeHumanMessage(args.message || "", phase, mode === "rescue" ? "" : user_input, firstName, hasPriorOutbound, lastAssistantMsg);
      args.message = sanitizeNumbers(args.message, billNum);
    }
    if (tool === "update_lead_field") {
      args.followup_message = sanitizeHumanMessage(args.followup_message || "", phase, mode === "rescue" ? "" : user_input, firstName, hasPriorOutbound, lastAssistantMsg);
      args.followup_message = sanitizeNumbers(args.followup_message, billNum);
    }
    if (tool === "send_media" && args.caption) {
      args.caption = sanitizeHumanMessage(args.caption, phase, mode === "rescue" ? "" : user_input, firstName, hasPriorOutbound, lastAssistantMsg);
      args.caption = sanitizeNumbers(args.caption, billNum);
    }

    // ---- Dispara summarize + extract-memory em background a cada 10 msgs ou se resumo > 24h ----
    const totalMsgs = history.length;
    const needSummary = (totalMsgs >= 10 && totalMsgs % 10 === 0) || (!summaryFresh && totalMsgs >= 12);
    const needMemory = totalMsgs >= 6 && totalMsgs % 6 === 0;
    const bgHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    };
    if (needSummary) {
      fetch(`${SUPABASE_URL}/functions/v1/ai-summarize-conversation`, {
        method: "POST", headers: bgHeaders, body: JSON.stringify({ customer_id }),
      }).catch(() => {});
    }
    if (needMemory) {
      fetch(`${SUPABASE_URL}/functions/v1/ai-extract-memory`, {
        method: "POST", headers: bgHeaders, body: JSON.stringify({ customer_id }),
      }).catch(() => {});
    }


    const latencyMs = Date.now() - t0;

    // Resolve média(s) selecionada(s). Suporta combo (1 áudio + 1 vídeo).
    type ResolvedMedia = { id: string; url: string; kind: string; label: string };
    let resolvedMedias: ResolvedMedia[] = [];
    if (tool === "send_media" && billAlreadyReceivedEarly) {
      // Hard guard: nunca enviar mídia depois da conta — sempre handoff.
      return new Response(
        JSON.stringify({
          decision: {
            tool: "request_handoff",
            args: {
              reason: "lead_pronto_cadastro: conta recebida; operador deve usar botões Cadastrar/OTP/Facial.",
              urgency: "alta",
            },
          },
          phase,
          latency_ms: latencyMs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (tool === "send_media") {
      const ids: string[] = Array.isArray(args.media_ids) ? args.media_ids : [];
      // Filtra: deve estar em freshMedia (não enviada antes), ter URL, kind único na seleção.
      const seenKinds = new Set<string>();
      for (const id of ids) {
        const m = freshMedia.find((x: any) => x.id === id);
        if (!m || !m.url) continue;
        if (seenKinds.has(m.kind)) continue;
        seenKinds.add(m.kind);
        resolvedMedias.push({ id: m.id, url: m.url, kind: m.kind, label: m.label });
        if (resolvedMedias.length === 2) break;
      }

      if (resolvedMedias.length === 0) {
        // Nenhum ID válido → fallback texto.
        const fallbackMsg =
          args.caption && args.caption.trim().length > 0
            ? args.caption
            : "Posso te explicar em poucas linhas se preferir.";
        args.reasoning = (args.reasoning || "") + " [media_ids inválidos/repetidos] fallback texto";
        return new Response(
          JSON.stringify({
            decision: {
              tool: "send_text",
              args: {
                message: sanitizeHumanMessage(fallbackMsg, phase, mode === "rescue" ? "" : user_input, firstName),
                next_phase: args.next_phase || phase,
                reasoning: args.reasoning,
              },
            },
            phase,
            latency_ms: latencyMs,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Atualiza args.media_ids com a lista validada (para auditoria).
      args.media_ids = resolvedMedias.map((m) => m.id);
    }
    const resolvedMedia: ResolvedMedia | null = resolvedMedias[0] || null;

    // ---- Self-check barato (flash-lite) — bloqueia tools absurdas ----
    let selfCheckRisk: string | null = null;
    try {
      const lastIn = mode === "rescue" ? "[rescue]" : (user_input || "").slice(0, 200);
      const checkPrompt = `Lead disse: "${lastIn}"\nIA escolheu: ${tool} ${JSON.stringify(args).slice(0, 250)}\nFase: ${phase}. Conta_recebida: ${billAlreadyReceivedEarly}.\nResponda apenas: OK ou RISCO_<motivo curto>.`;
      const sc = await geminiGenerate({
        model: MODEL_SELFCHECK,
        contents: [{ role: "user", parts: [{ text: checkPrompt }] }],
        temperature: 0,
        maxOutputTokens: 30,
        functionName: "ai-sales-agent-selfcheck",
        consultantId: customer.consultant_id,
        customerId: customer_id,
      });
      const verdict = (sc.text || "").trim().toUpperCase();
      if (verdict.startsWith("RISCO")) selfCheckRisk = verdict.slice(0, 80);
    } catch (_) { /* self-check é best-effort */ }

    // Detecção de intenção determinística (para auditoria)
    const ui = (user_input || "").toLowerCase();
    const intentDetected =
      /\b(cadastr|quero (entrar|participar|aderir|economizar|fazer)|fazer (adesao|adesão|cadastro)|me cadastra|vamos l[aá]|bora|bora la|aceito|topo|fechado|pode (cadastrar|prosseguir|seguir)|j[aá] quero)\b/i.test(ui) ? "cadastrar" :
      /\b(humano|atendente|pessoa|operador|consultor real|fala com (algu[eé]m|gente|pessoa)|chama (o|a) (consultor|atendente))\b/i.test(ui) ? "humano" :
      /\b(parar|cancelar|n[aã]o quero|sem interesse|desisto|me deixa|para de|tira meu|nao tenho interesse|n[aã]o me|n[aã]o gostei)\b/i.test(ui) ? "desistir" :
      /\b(golpe|fraude|seguro\?|confi[aá]vel|enganaç[aã]o|verdade)\b/i.test(ui) ? "objecao_confianca" :
      /\b(fidelidade|multa|trocar|mudar de empresa|distribuidora vai)\b/i.test(ui) ? "objecao_contrato" :
      /\b(custo|caro|gratuito|de gra[çc]a|paga|mensalidade|taxa)\b/i.test(ui) ? "objecao_custo" :
      /\b(quanto|valor|economia|pre[çc]o|desconto|porcentagem)\b/i.test(ui) ? "interesse_valor" :
      /\b(como funciona|me explica|n[aã]o entendi|o que [eé]|quem [eé])\b/i.test(ui) ? "informacao" :
      null;

    // Audit (best-effort) — uma linha por mídia enviada (para cooldown 1× por lead pegar todas).
    const auditRows =
      resolvedMedias.length > 1
        ? resolvedMedias.map((m) => ({
            customer_id,
            consultant_id: customer.consultant_id,
            phase,
            tool_called: tool,
            reasoning: (args.reasoning || args.reason || "") + (selfCheckRisk ? ` | ${selfCheckRisk}` : "") + ` [combo:${m.kind}]`,
            user_input: mode === "rescue" ? "[rescue]" : user_input,
            ai_output: args,
            latency_ms: latencyMs,
            model: aiResult.modelUsed,
            media_sent_id: m.id,
            intent_detected: intentDetected,
          }))
        : [{
            customer_id,
            consultant_id: customer.consultant_id,
            phase,
            tool_called: tool,
            reasoning: (args.reasoning || args.reason || "") + (selfCheckRisk ? ` | ${selfCheckRisk}` : ""),
            user_input: mode === "rescue" ? "[rescue]" : user_input,
            ai_output: args,
            latency_ms: latencyMs,
            model: aiResult.modelUsed,
            media_sent_id: resolvedMedia?.id || null,
            intent_detected: intentDetected,
          }];
    await supabase.from("ai_decisions").insert(auditRows);

    // Se self-check sinalizou RISCO em tool sensível, força fallback texto neutro
    if (selfCheckRisk && (tool === "send_media" || tool === "advance_to_closing")) {
      const safeMsg = "Para eu te dar o número certo: qual a média da sua conta de luz?";
      return new Response(JSON.stringify({
        decision: { tool: "send_text", args: { message: safeMsg, next_phase: phase, reasoning: `selfcheck_blocked:${selfCheckRisk}` } },
        phase,
        latency_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Apply side-effects (DB updates only — sending message stays in webhook)
    const updates: Record<string, any> = {};
    if (tool === "send_text" && args.next_phase) updates.sales_phase = args.next_phase;
    if (tool === "send_media" && args.next_phase) updates.sales_phase = args.next_phase;
    if (tool === "advance_to_closing") updates.sales_phase = "fechamento";
    if (tool === "confirm_and_handoff") {
      updates.sales_phase = "fechamento";
      updates.bot_paused = true;
      updates.bot_paused_reason = "confirm_and_handoff: lead pronto para cadastro";
      updates.bot_paused_at = new Date().toISOString();
      updates.qualification_score = 100;
    }
    if (tool === "update_lead_field") {
      const f = String(args.field || "");
      const v = args.value;
      if (["name", "distribuidora", "pain_point"].includes(f) && typeof v === "string" && v.length > 1) {
        updates[f] = v.trim();
        if (f === "name") updates.name_source = "self_introduced";
      }
      if (f === "electricity_bill_value") {
        const n = Number(String(v).replace(/[^\d.,]/g, "").replace(",", "."));
        if (Number.isFinite(n) && n > 0) updates.electricity_bill_value = n;
      }
      if (args.next_phase) updates.sales_phase = args.next_phase;
    }
    if (tool === "request_handoff") {
      updates.bot_paused = true;
      updates.bot_paused_reason = args.reason;
      updates.bot_paused_at = new Date().toISOString();
    }
    if (tool === "schedule_followup") {
      updates.next_followup_at = new Date(Date.now() + (args.hours || 24) * 3600 * 1000).toISOString();
    }
    if (tool === "mark_lost") {
      updates.sales_phase = "perdido";
      updates.bot_paused = true;
      updates.bot_paused_reason = `mark_lost: ${args.reason}`;
    }
    // Apply qualification score delta
    if ((tool === "send_text" || tool === "send_media") && typeof args.score_delta === "number") {
      const current = Number(customer.qualification_score ?? 0);
      const next = Math.max(0, Math.min(100, current + args.score_delta));
      updates.qualification_score = next;
    }
    if (tool === "advance_to_closing") {
      updates.qualification_score = Math.max(Number(customer.qualification_score ?? 0), 90);
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from("customers").update(updates).eq("id", customer_id);
    }

    return new Response(
      JSON.stringify({
        decision: { tool, args },
        media: resolvedMedia,
        medias: resolvedMedias,
        phase,
        latency_ms: latencyMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ai-sales-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
