// AI Agent Router — orquestrador do agente humanizado.
// Chamado pelo evolution-webhook quando o cliente NÃO está pausado e o consultor
// tem ai_agent_config.enabled=true.
//
// Faz: carrega contexto (cliente + últimas msgs + config + biblioteca de mídias),
// chama Gemini com saída estruturada, executa as ações decididas pela IA
// (enviar texto, enviar mídia da library, atualizar step, transferir p/ humano),
// loga em ai_agent_logs.
//
// Body: {
//   customer_id: string,
//   instance_name: string,
//   user_input: string,
//   user_input_kind: "text" | "audio_transcript" | "image_caption" | "document",
//   remote_jid: string
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";
import { geminiGenerate, GeminiQuotaExhausted } from "../_shared/gemini.ts";
import { lookupKnowledge } from "../_shared/knowledge-lookup.ts";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import {
  checkPreconditions,
  deterministicFallback,
  filterMediaIds,
  type GroundingContext,
  sanitizeHumanReply as groundedSanitizeHumanReply,
  validateAudioSlot,
  validateNextStep,
} from "../_shared/grounding.ts";
import {
  type FlowReliabilityV2Flag,
  getFlowReliabilityV2,
  isV2Active,
  isV2Enabled,
} from "../_shared/feature-flag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

// Etapas válidas do funil (alinhadas com conversation_step)
const FUNNEL_STEPS = [
  "welcome", "qualificacao", "apresentacao", "objecoes",
  "coleta_conta", "coleta_doc", "coleta_dados",
  "cadastro_portal", "aguardando_otp", "aguardando_facial",
  "complete", "handoff_humano",
] as const;

// Mirror of CADASTRO_STEPS from evolution-webhook/handlers/conversational/index.ts
// Kept here to avoid cross-function imports between Edge Functions and to
// support the validateNextStep gate per design §6 / bugfix 2.18.
const CADASTRO_STEPS: ReadonlySet<string> = new Set([
  "aguardando_conta", "processando_ocr_conta", "confirmando_dados_conta",
  "ask_tipo_documento", "aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso",
  "confirmando_dados_doc", "confirmar_titularidade", "ask_name", "ask_cpf", "ask_rg", "ask_birth_date",
  "ask_phone_confirm", "ask_phone", "ask_email", "ask_cep", "ask_number",
  "ask_complement", "ask_installation_number", "ask_bill_value",
  "ask_distribuidora",
  "ask_doc_frente_manual", "ask_doc_verso_manual",
  "ask_contaunica", "ask_transferir_titularidade", "ask_finalizar",
  "finalizando", "portal_submitting", "aguardando_otp", "validando_otp",
  "aguardando_facial", "aguardando_assinatura", "cadastro_em_analise", "complete", "aguardando_humano",
  "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
  "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao", "editing_conta_valor",
  "editing_doc_menu", "editing_doc_nome", "editing_doc_cpf", "editing_doc_rg",
  "editing_doc_nascimento", "editing_doc_pai", "editing_doc_mae",
]);

const ALLOWED_LINK_DOMAINS = [
  "igreen.energy",
  "igreenenergybrasil.site",
  "igreenenergybrasil.com",
];

const INTENTS = [
  "saudacao","duvida","objecao","aceite","recusa",
  "pediu_humano","enviou_midia","confuso","fora_escopo",
  "frio","quente","desconfiado",
] as const;

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", description: "Intenção detectada do cliente em 1-3 palavras" },
    detected_intent: { type: "string", enum: [...INTENTS], description: "Categoria estruturada da intenção" },
    pain_point: { type: "string", description: "Dor/necessidade detectada em até 60 chars. Vazio se nada claro." },
    qualification_score: { type: "integer", minimum: 0, maximum: 10, description: "Quão pronto o lead está pra fechar" },
    objection_type: { type: "string", description: "Tipo da objeção (preco, confianca, instalacao, prazo, etc). Vazio se sem objeção." },
    should_pause_seconds: { type: "integer", minimum: 0, maximum: 8, description: "Pausa antes de enviar (humanização)" },
    next_step: { type: "string", enum: [...FUNNEL_STEPS] },
    reply_text: { type: "string", description: "Texto curto humanizado. Vazio se for só enviar mídia/áudio." },
    media_to_send_ids: { type: "array", items: { type: "string" } },
    audio_slot_key: { type: "string", description: "slot_key do áudio do consultor (biblioteca de slots). Vazio se nenhum." },
    handoff: { type: "boolean" },
    handoff_reason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "intent","detected_intent","pain_point","qualification_score","objection_type",
    "should_pause_seconds","next_step","reply_text","media_to_send_ids",
    "audio_slot_key","handoff","handoff_reason","confidence",
  ],
} as const;

// Similaridade simples por trigrams para anti-loop
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, "").replace(/\s+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const trig = (s: string) => {
    const set = new Set<string>();
    const p = `  ${s}  `;
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = trig(A), tb = trig(B);
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

// F11: Detecta mensagens repetitivas ou que parecem loop de bot
function isLikelyLooping(history: any[], userInput: string): boolean {
  if (!history || history.length < 3) return false;
  const lastBotMsgs = history
    .filter(m => m.message_direction === 'outbound')
    .slice(0, 2)
    .map(m => m.message_text || "");
  
  return lastBotMsgs.some(msg => similarity(msg, userInput) > 0.85);
}

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sanitizeHumanReply(text: string, step: string, input: string): string {
  const msg = (text || "").trim().replace(/🤖/g, "").trim();
  // "assistente virtual" agora é PERMITIDO (a IA deve ser transparente).
  // Bloqueia só clichês robóticos / termos frios que soam de bot ruim.
  const forbidden = /(\bbot\b|sistema autom[aá]tico|como posso ajudar|fico (à|a) disposição|atendimento digital)/i;
  const shortGreeting = /^(oi|ol[aá]|opa|bom dia|boa tarde|boa noite|tudo bem|eai|e aí)[!?.\s]*$/i.test((input || "").trim());
  if (!msg || forbidden.test(msg) || msg.length > 280) {
    if (shortGreeting || step === "welcome" || step === "menu_inicial") return "oii 😊 vc é de qual cidade?";
    if (step === "qualificacao") return "me conta uma coisa: quanto vem mais ou menos sua conta de luz?";
    if (step === "apresentacao") return "posso fazer uma continha rápida pra ver sua economia?";
    if (step === "objecoes") return "super entendo. o que ficou pegando pra vc?";
    return "me manda uma foto da sua conta que eu vejo isso rapidinho pra vc 👌";
  }
  return msg;
}

function isShortOpeningGreeting(input: string, step: string): boolean {
  const isOpeningStep = step === "welcome" || step === "menu_inicial" || !step;
  if (!isOpeningStep) return false;
  return /^(oi|ol[aá]|opa|bom dia|boa tarde|boa noite|tudo bem|eai|e aí)[!?.\s]*$/i.test((input || "").trim());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { customer_id, instance_name, user_input, user_input_kind = "text", remote_jid } = await req.json();
    if (!customer_id || !instance_name || !remote_jid) {
      return new Response(JSON.stringify({ error: "customer_id, instance_name, remote_jid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── Guarda de autenticação/posse (IDOR) — ANTES de qualquer efeito colateral ───
    // A chamada interna do evolution-webhook envia `x-service-secret` → resolve
    // como `mode: "service"` e dispensa a verificação de posse (mantém o caminho
    // interno funcionando). Chamadas via JWT precisam ser donas do `customer_id`.
    const caller = await resolveCaller(req, supabase as any);
    if (caller instanceof Response) return caller; // 401
    const deny = await assertOwnership(caller, { customerId: customer_id }, supabase as any);
    if (deny) return deny; // 400/403

    // 1) Carregar cliente
    const { data: customer } = await supabase.from("customers").select("*").eq("id", customer_id).single();
    if (!customer) return new Response(JSON.stringify({ error: "customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 2) Se bot pausado OU humano vinculado, sair (segurança extra).
    if (customer.bot_paused || customer.assigned_human_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "bot_paused" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const consultantId = customer.consultant_id;

    // Identidade da assistente: nome configurado pelo consultor + do/da.
    const { data: _consultorRow } = await supabase
      .from("consultants")
      .select("name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    const assistantName = (_consultorRow as any)?.assistant_name?.trim() || "Assistente";
    const representanteNome = (_consultorRow as any)?.name?.trim() || "";
    const artigoRep = String((_consultorRow as any)?.gender) === "consultora" ? "da" : "do";

    // 3) Carregar config do agente. PRIORIDADE: config explícita do consultor.
    // Se o consultor desligou (enabled=false), respeitamos — não caímos no global.
    const { data: cfgPrivate } = await supabase
      .from("ai_agent_config").select("*").eq("consultant_id", consultantId).maybeSingle();
    const { data: cfgGlobal } = await supabase
      .from("ai_agent_config").select("*").is("consultant_id", null).maybeSingle();
    const config = cfgPrivate || cfgGlobal;

    // Se existe config explícita do consultor com enabled=false → SAIR.
    if (cfgPrivate && (cfgPrivate as any).enabled === false) {
      return new Response(JSON.stringify({ ok: true, skipped: "consultant_disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!config?.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "agent_disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── KB-only gate (2026-05-26): IA = só lookup, nunca gera texto ───
    // Política: o ai-agent-router NÃO chama mais o LLM para escrever
    // resposta criativa. Em vez disso, faz lookup determinístico em
    // bot_flow_qa + ai_knowledge_sections. Se achar → envia texto da
    // base. Se NÃO achar → handoff humano (sem chamar Gemini).
    //
    // Gate desligável via setting `ai_kb_only_mode`. Default ON (kb-only).
    // Para reativar geração LLM, setar `settings.ai_kb_only_mode = "false"`.
    const { data: kbOnlySetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "ai_kb_only_mode")
      .maybeSingle();
    const kbOnlyMode = (kbOnlySetting as any)?.value !== "false"; // default true

    if (kbOnlyMode) {
      try {
        if (isShortOpeningGreeting(user_input || "", customer.conversation_step || "welcome")) {
          try {
            await supabase.from("ai_agent_logs").insert({
              consultant_id: consultantId,
              customer_id,
              phone: customer.phone_whatsapp,
              step_before: customer.conversation_step,
              step_after: customer.conversation_step,
              llm_output: { kb_only: true, skipped: "opening_greeting" },
              handoff: false,
              latency_ms: Date.now() - t0,
            });
          } catch (_) { /* swallow */ }
          return new Response(
            JSON.stringify({ ok: true, mode: "kb_only", skipped: "opening_greeting" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { lookupKnowledge } = await import("../_shared/knowledge-lookup.ts");
        const lookup = await lookupKnowledge({
          supabase,
          question: user_input || "",
          consultantId,
        });
        const _raw = createEvolutionSender(EVOLUTION_API_URL, EVOLUTION_API_KEY, instance_name);
        const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
        const sender = wrapSenderWithGuard(_raw, { supabase, instanceName: instance_name });

        if (lookup.found && lookup.text) {
          // F11: Se o match veio da Base de Conhecimento e é muito curto (confiança baixa), 
          // ou se a mensagem do usuário parece ser um spam de sistema, não responde nada ou vai p/ handoff.
          const isSuspect = (user_input || "").length > 300 || lookup.confidence < 0.4 || isLikelyLooping(historyChrono || [], user_input || "");
          
          if (!isSuspect) {
            try {
              await sender.sendText(remote_jid, lookup.text);
            } catch (e: any) {
              console.warn("[ai-agent-router/kb_only] sendText failed:", e?.message);
            }
          }
          
          // Log (mesmo se suspect, para auditoria)
          try {
            await supabase.from("ai_agent_logs").insert({
              consultant_id: consultantId,
              customer_id,
              phone: customer.phone_whatsapp,
              step_before: customer.conversation_step,
              step_after: customer.conversation_step,
              llm_output: { kb_only: true, source: lookup.source, confidence: lookup.confidence, suppressed: isSuspect },
              handoff: false,
              latency_ms: Date.now() - t0,
            });
          } catch (_) { /* swallow */ }
          
          return new Response(
            JSON.stringify({ ok: true, mode: "kb_only", source: lookup.source, suppressed: isSuspect }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Sem match → handoff. Mensagem fixa (sem LLM).
        try {
          await sender.sendText(remote_jid, "Vou pedir para alguém do time te explicar essa parte 🙌");
        } catch (e: any) {
          console.warn("[ai-agent-router/kb_only] handoff sendText failed:", e?.message);
        }
        try {
          await supabase
            .from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "ai_no_kb_match",
              bot_paused_at: new Date().toISOString(),
            })
            .eq("id", customer_id);
          await supabase.from("bot_handoff_alerts").insert({
            customer_id,
            consultant_id: consultantId,
            reason: "ai_no_kb_match",
            metadata: { source: "ai_agent_router_kb_only", question: user_input },
          });
          await supabase.from("ai_agent_logs").insert({
            consultant_id: consultantId,
            customer_id,
            phone: customer.phone_whatsapp,
            step_before: customer.conversation_step,
            step_after: "handoff_humano",
            llm_output: { kb_only: true, no_match: true },
            handoff: true,
            latency_ms: Date.now() - t0,
          });
        } catch (_) { /* swallow */ }
        return new Response(
          JSON.stringify({ ok: true, mode: "kb_only", handoff: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e: any) {
        console.error("[ai-agent-router/kb_only] failed:", e?.message);
        // Em erro do lookup, escala humano. Não cai em LLM.
        try {
          await supabase
            .from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "ai_kb_lookup_error",
              bot_paused_at: new Date().toISOString(),
            })
            .eq("id", customer_id);
        } catch (_) { /* swallow */ }
        return new Response(
          JSON.stringify({ ok: false, mode: "kb_only", error: e?.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    // Caminho LLM tradicional só executa se kbOnlyMode=false (override
    // explícito via setting).

    // 4) Histórico (últimas 12 msgs)
    const { data: history } = await supabase
      .from("conversations")
      .select("message_direction, message_text, created_at")
      .eq("customer_id", customer_id)
      .order("created_at", { ascending: false })
      .limit(12);
    const historyChrono = (history || []).reverse();

    // 5) Mídias disponíveis: UNION privadas do consultor + públicas (templates)
    const stepBefore = customer.conversation_step || "welcome";
    const { data: mediaPrivate } = await supabase
      .from("ai_media_library")
      .select("id, kind, label, step_tags, intent_tags, transcript, text_content, url, priority, is_public")
      .eq("consultant_id", consultantId).eq("active", true);
    const { data: mediaPublic } = await supabase
      .from("ai_media_library")
      .select("id, kind, label, step_tags, intent_tags, transcript, text_content, url, priority, is_public")
      .eq("is_public", true).eq("active", true);
    const mediaLibrary = [...(mediaPrivate || []), ...(mediaPublic || [])];

    // Prioriza privadas do consultor sobre públicas para mesma intent
    const seenIntents = new Set<string>();
    const relevantMedia = mediaLibrary
      .filter((m: any) => Array.isArray(m.step_tags) && (m.step_tags.length === 0 || m.step_tags.includes(stepBefore) || m.step_tags.includes("any")))
      .sort((a: any, b: any) => {
        // privadas primeiro, depois priority desc
        if (!!a.is_public !== !!b.is_public) return a.is_public ? 1 : -1;
        return (b.priority || 0) - (a.priority || 0);
      })
      .filter((m: any) => {
        const key = (m.intent_tags || []).join(",") || m.id;
        if (seenIntents.has(key)) return false;
        seenIntents.add(key);
        return true;
      });

    // 6) Conhecimento iGreen: seções do consultor + globais
    const { data: knowledge } = await supabase
      .from("ai_knowledge_sections")
      .select("title, content")
      .eq("is_active", true)
      .or(`consultant_id.is.null,consultant_id.eq.${consultantId}`)
      .order("consultant_id", { ascending: false, nullsFirst: true })
      .order("position");

    // 6a) Pergunta diferente / fora do roteiro: busca SEMÂNTICA + palavra-chave
    // (FAQ + seções) pela mensagem do cliente. O trecho mais relevante entra no
    // topo do CONHECIMENTO, ajudando a IA a responder pergunta específica.
    let conhecimentoFocado = "";
    try {
      const kb = await lookupKnowledge({ supabase, question: String(user_input || ""), consultantId });
      if (kb.found && kb.text) {
        conhecimentoFocado = `### RESPOSTA MAIS RELEVANTE PARA A PERGUNTA ATUAL\n${kb.text}\n\n`;
      }
    } catch (_e) { /* fail-open: segue só com o conhecimento geral */ }

    // 6b) Slots de áudio (Camila)
    const { data: slotsRaw } = await supabase
      .from("ai_agent_slots")
      .select("slot_key, label, trigger_hint, fallback_text, min_interval_minutes, is_testing, video_url, video_label")
      .eq("active", true)
      .order("position");
    const slots = slotsRaw || [];
    const validSlotKeys = new Set(slots.map((s: any) => s.slot_key));

    // 7) Montar prompt
    const persona = assistantName;
    const tone = config.tone || "humano, breve, cordial";
    const stepPromptMap = (config.step_prompts || {}) as Record<string, string>;
    const stepGuide = stepPromptMap[stepBefore] || "";
    const handoffRules = (config.handoff_rules || {}) as Record<string, any>;

    const identidadeLinha = representanteNome
      ? `Você é ${persona}, a assistente virtual ${artigoRep} ${representanteNome} (consultor(a) da iGreen Energy).`
      : `Você é ${persona}, a assistente virtual da iGreen Energy.`;

    const systemPrompt = `${identidadeLinha} Tom: ${tone}.
TRANSPARÊNCIA: você é uma assistente virtual (IA). Se o cliente perguntar se é robô/IA/atendente, confirme com naturalidade que é uma assistente virtual que ajuda ${representanteNome ? artigoRep + " " + representanteNome : "o time"} — NUNCA diga que é uma pessoa humana.
Fale curto, natural, com gírias leves brasileiras quando apropriado. Sem emojis robóticos ("🤖"). No primeiro contato, pode se apresentar como "${persona}".
Seja OBJETIVA e direta: vá ao ponto, no máximo 2 a 3 linhas curtas, UMA pergunta por vez. Evite parágrafos longos, listas e textão — menos é mais.
Se o lead mandar só "oi"/"olá"/cumprimento curto, não explique a empresa: responda como pessoa e faça UMA pergunta simples, tipo "oii 😊 vc é de qual cidade?".
Não despeje explicação no começo. Primeiro conecte, depois qualifique.

REGRAS DURAS:
- Siga rigorosamente a ETAPA ATUAL: "${stepBefore}". Não pule etapas sem condição satisfeita.
- Se já existe áudio/vídeo na biblioteca para essa etapa/intenção, PREFIRA enviar a mídia (mais humano que texto).
- NUNCA invente preço, prazo, comissão, link, número de clientes/estados, CNPJ ou datas. Use SÓ o conhecimento abaixo; se não estiver lá, diga que confirma e faça handoff.
- Se cliente: pedir humano, ofender, perguntar algo fora do escopo, ou após 3 falhas de entendimento → handoff=true.
- Para avançar para "cadastro_portal" o cliente precisa ter aceitado a proposta e ter conta de luz + documento enviados.

${config.system_prompt || ""}

ETAPA ATUAL: ${stepBefore}
${stepGuide ? `Guia da etapa: ${stepGuide}` : ""}

REGRAS DE HANDOFF: ${JSON.stringify(handoffRules)}

CONHECIMENTO iGREEN:
${conhecimentoFocado}${(knowledge || []).map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n").slice(0, 4000)}

DADOS DO CLIENTE:
${JSON.stringify({
  name: customer.name, name_source: (customer as any).name_source, cidade: customer.address_city, uf: customer.address_state,
  conta_valor: customer.electricity_bill_value, distribuidora: customer.distribuidora,
  step: stepBefore, status: customer.status,
}, null, 2)}

BIBLIOTECA DE MÍDIAS DISPONÍVEIS PARA ESTA ETAPA (use o id em media_to_send_ids):
${relevantMedia.map((m: any) => `- id=${m.id} kind=${m.kind} label="${m.label}" intent_tags=${JSON.stringify(m.intent_tags || [])}${m.transcript ? ` transcript="${(m.transcript || "").slice(0, 120)}"` : ""}`).join("\n") || "(nenhuma)"}

ÁUDIOS DO CONSULTOR (slots fixos da biblioteca — preencha "audio_slot_key" com o slot_key apropriado quando o gatilho bater; deixe vazio se nenhum se aplica). NUNCA cite o nome "Rafael" (ou qualquer outro nome de consultor) no reply_text — use apenas o nome do consultor atual quando ele estiver disponível no contexto. Slots marcados com 🎬 enviam um vídeo automaticamente logo após o áudio:
${slots.map((s: any) => `- slot_key=${s.slot_key} (${s.label})${s.video_url ? " 🎬+vídeo" : ""}: ${s.trigger_hint || ""}`).join("\n") || "(nenhum)"}

RESPONDA APENAS com o JSON do schema. reply_text deve ser CURTO (1-3 frases). Se for enviar áudio/vídeo, geralmente reply_text fica vazio ou bem curto. Se houver um slot_key apropriado, prefira "audio_slot_key" em vez de "media_to_send_ids".`;

    const userMessages = historyChrono.map((m: any) => ({
      role: m.message_direction === "inbound" ? "user" : "assistant",
      content: m.message_text || "",
    } as const));

    // Última mensagem (a recém-recebida) — pode já estar no histórico, anexa label do tipo
    const lastInboundLabel = user_input_kind === "audio_transcript"
      ? `[áudio transcrito] ${user_input}`
      : user_input_kind === "image_caption"
        ? `[imagem descrita] ${user_input}`
        : user_input;

    // 8) Chamar IA
    let decision: any = null;
    let llmError: string | null = null;
    try {
      const contents = [
        ...userMessages.map((m) => ({
          role: m.role === "assistant" ? ("model" as const) : ("user" as const),
          parts: [{ text: m.content }],
        })),
        { role: "user" as const, parts: [{ text: lastInboundLabel }] },
      ];
      const result = await geminiGenerate({
        model: "gemini-2.5-flash",
        fallbackModel: "gemini-2.5-flash-lite",
        system: systemPrompt,
        contents,
        temperature: 0.4,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
        responseSchema: DECISION_SCHEMA as any,
        functionName: "ai-agent-router",
        consultantId,
        customerId: customer_id,
      });
      decision = result.text ? JSON.parse(result.text) : null;
    } catch (e: any) {
      llmError = e?.message || String(e);
      // Quota exhausted → deterministic fallback path. We log the event
      // (so saude-bot/observability can spot consultants hitting the
      // ceiling) and then fall through to the same "no decision" branch
      // that handles a generic LLM error. The deterministicFallback
      // helper below produces a safe REPEAT-style decision that keeps
      // the customer on the current step rather than inventing a
      // hallucinated reply.
      if (e instanceof GeminiQuotaExhausted) {
        try {
          await supabase.from("ai_agent_logs").insert({
            consultant_id: consultantId,
            customer_id,
            phone: customer.phone_whatsapp,
            step_before: stepBefore,
            step_after: stepBefore,
            error: "gemini_quota_exhausted",
            llm_output: { violation_kind: "gemini_quota_exhausted" },
            handoff: false,
            latency_ms: Date.now() - t0,
          });
        } catch (_) { /* never fail the request because of telemetry */ }
        console.warn("LLM degraded → deterministicFallback (quota exhausted)");
      } else {
        console.error("LLM error:", llmError);
      }
    }

    // 9) Fallback se LLM quebrou
    if (!decision) {
      decision = {
        intent: "fallback",
        detected_intent: "confuso",
        pain_point: "",
        qualification_score: 0,
        objection_type: "",
        should_pause_seconds: 0,
        next_step: stepBefore,
        reply_text: "",
        media_to_send_ids: [],
        audio_slot_key: "",
        handoff: false,
        handoff_reason: "llm_error",
        confidence: 0,
      };
    }

    if (decision.reply_text) {
      decision.reply_text = sanitizeHumanReply(decision.reply_text, stepBefore, user_input || "");
    }

    // 9b) Anti-loop: se reply for ≥80% similar à última msg outbound, esvazia
    if (decision.reply_text && decision.reply_text.trim()) {
      const lastOut = [...historyChrono].reverse().find((m: any) => m.message_direction === "outbound");
      if (lastOut?.message_text && similarity(decision.reply_text, lastOut.message_text) >= 0.8) {
        console.log("🔁 anti-loop: reply muito parecido com último outbound, esvaziando");
        decision.reply_text = "";
        if (!decision.audio_slot_key && !(decision.media_to_send_ids || []).length) {
          decision.handoff = true;
          decision.handoff_reason = "anti_loop";
        }
      }
    }

    // 9c) 3x confuso seguidos -> handoff
    if (decision.detected_intent === "confuso") {
      const { data: lastLogs } = await supabase
        .from("ai_agent_logs")
        .select("llm_output")
        .eq("customer_id", customer_id)
        .order("created_at", { ascending: false })
        .limit(2);
      const prevConfused = (lastLogs || []).filter((l: any) =>
        l?.llm_output?.detected_intent === "confuso").length;
      if (prevConfused >= 2) {
        decision.handoff = true;
        decision.handoff_reason = "3x_confuso";
      }
    }

    // 9d) Pediu humano -> força handoff
    if (decision.detected_intent === "pediu_humano") {
      decision.handoff = true;
      decision.handoff_reason = decision.handoff_reason || "pediu_humano";
    }

    // ─── 9e) Pipeline de validação (Tasks 22 + 29 — bugfix 2.18, 2.27..2.31) ───
    //
    // Ordem (design §6):
    //   validateNextStep → filterMediaIds → validateAudioSlot
    //   → sanitizeHumanReply (grounded) → checkPreconditions → deterministicFallback
    //
    // Gate por feature flag `consultants.flow_reliability_v2`:
    //   'off'           → caminho legado, sem validação.
    //   'dark'          → validação + log, mas emite a decisão original.
    //   'canary' / 'on' → emite a decisão validada (finalDecision).
    //
    // Toda violação é registrada em `ai_agent_logs` via logAiViolation. Insert
    // failures são engolidas para nunca quebrar o caminho do cliente.
    const flowFlag: FlowReliabilityV2Flag = await getFlowReliabilityV2(
      supabase,
      consultantId,
    );

    /** Insere uma linha de violação em `ai_agent_logs`. Nunca lança. */
    async function logAiViolation(
      kind: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      try {
        await supabase.from("ai_agent_logs").insert({
          consultant_id: consultantId,
          customer_id,
          phone: customer.phone_whatsapp,
          step_before: stepBefore,
          step_after: stepBefore,
          // `ai_agent_logs` não tem coluna `kind` dedicada — ancoramos a tag
          // dentro de `error` (já indexada para read-only inspection) e
          // anexamos o payload em `llm_output` para inspeção rica.
          error: kind,
          llm_output: { violation_kind: kind, ...payload },
          handoff: false,
          latency_ms: Date.now() - t0,
        });
      } catch (e) {
        console.warn(`logAiViolation(${kind}) falhou:`, (e as any)?.message);
      }
    }

    let finalDecision = decision;
    if (isV2Enabled(flowFlag)) {
      // (1) Conjunto de steps válidos: CADASTRO_STEPS ∪ FUNNEL_STEPS ∪ steps ativos
      // do consultor em `bot_flow_steps` (referenciados via `bot_flows`).
      const validSteps = new Set<string>([...CADASTRO_STEPS, ...FUNNEL_STEPS]);
      const stepTemplates: Record<string, string> = {};
      try {
        const { data: consultantFlows } = await supabase
          .from("bot_flows")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("is_active", true);
        const flowIds = ((consultantFlows as any[]) || [])
          .map((f) => f?.id)
          .filter((id) => !!id);
        if (flowIds.length > 0) {
          const { data: stepRows } = await supabase
            .from("bot_flow_steps")
            .select("step_key, message_text")
            .in("flow_id", flowIds)
            .eq("is_active", true);
          for (const row of (stepRows as any[]) || []) {
            const key = row?.step_key ? String(row.step_key) : "";
            if (key) {
              validSteps.add(key);
              if (typeof row.message_text === "string" && row.message_text.trim()) {
                stepTemplates[key] = row.message_text;
              }
            }
          }
        }
      } catch (e) {
        console.warn("validation: failed to load consultant steps:", (e as any)?.message);
      }

      // (2) IDs de mídia relevantes — `relevantMedia` já foi computado em §5.
      const relevantMediaIds = new Set<string>(
        (relevantMedia || [])
          .map((m: any) => m?.id ? String(m.id) : "")
          .filter((s: string) => s.length > 0),
      );

      // (3) Contexto de grounding: knowledge + customer + allowedDomains.
      const groundingCtx: GroundingContext = {
        knowledgeSections: ((knowledge as any[]) || []).map((k) => ({
          title: k?.title,
          body: String(k?.content || ""),
        })),
        customer,
        allowedDomains: ALLOWED_LINK_DOMAINS,
      };

      // (4) validateNextStep — atende 2.18.
      const proposedNextStep = String(decision.next_step || "");
      const safeNextStep = validateNextStep(proposedNextStep, validSteps, stepBefore);
      if (safeNextStep !== proposedNextStep) {
        await logAiViolation("ai_invalid_next_step", {
          proposed: proposedNextStep,
          current: stepBefore,
          chosen: safeNextStep,
        });
      }

      // (5) filterMediaIds — atende 2.28.
      const { kept: keptMediaIds, dropped: droppedMediaIds } = filterMediaIds(
        Array.isArray(decision.media_to_send_ids) ? decision.media_to_send_ids : [],
        relevantMediaIds,
      );
      if (droppedMediaIds.length > 0) {
        await logAiViolation("ai_hallucinated_media_id", {
          dropped: droppedMediaIds,
          relevant_count: relevantMediaIds.size,
        });
      }

      // (6) validateAudioSlot — atende 2.29.
      const proposedSlot = String(decision.audio_slot_key || "");
      const safeAudioSlot = validateAudioSlot(proposedSlot, validSlotKeys, stepBefore);
      if (proposedSlot && safeAudioSlot !== proposedSlot) {
        await logAiViolation("ai_invalid_audio_slot", {
          proposed: proposedSlot,
          chosen: safeAudioSlot,
          current_step: stepBefore,
        });
      }

      // (7) sanitizeHumanReply (grounded) — atende 2.27.
      const originalReply = String(decision.reply_text || "");
      const safeReply = groundedSanitizeHumanReply(originalReply, groundingCtx);
      if (originalReply.trim() && !safeReply) {
        await logAiViolation("ai_reply_scrubbed", {
          original: originalReply.slice(0, 200),
        });
      }

      // (8) checkPreconditions — atende 2.31.
      const pre = checkPreconditions(safeNextStep, customer);
      const finalNextStep = pre.ok ? safeNextStep : stepBefore;
      if (!pre.ok) {
        await logAiViolation("ai_precondition_failed", {
          step: safeNextStep,
          reason: pre.reason,
        });
      }

      // (9) deterministicFallback se tudo esvaziou — atende 2.30.
      const everythingEmpty = !safeReply && !safeAudioSlot && keptMediaIds.length === 0;
      if (everythingEmpty) {
        const fb = deterministicFallback(stepBefore, stepTemplates);
        await logAiViolation("ai_deterministic_fallback", {
          reason: "all_outputs_empty",
          template_used: !!stepTemplates[stepBefore],
        });
        finalDecision = {
          ...decision,
          reply_text: fb.reply_text,
          next_step: fb.next_step,
          media_to_send_ids: fb.media_to_send_ids,
          audio_slot_key: fb.audio_slot_key,
          should_pause_seconds: fb.should_pause_seconds,
        };
      } else {
        finalDecision = {
          ...decision,
          reply_text: safeReply,
          next_step: finalNextStep,
          media_to_send_ids: keptMediaIds,
          audio_slot_key: safeAudioSlot,
        };
      }
    }

    // Aplicação do resultado: em 'canary'/'on', a decisão validada vira a
    // decisão emitida. Em 'dark', as violações foram logadas mas o caminho
    // legado segue inalterado (decisão original). Em 'off', `finalDecision`
    // === `decision` (atribuição inicial), nada muda.
    if (isV2Active(flowFlag)) {
      decision = finalDecision;
    }

    // 10) Executar ações
    const _rawSender = createEvolutionSender(EVOLUTION_API_URL, EVOLUTION_API_KEY, instance_name);
    const { wrapSenderWithGuard: _wrap } = await import("../_shared/sender-guard.ts");
    const sender = _wrap(_rawSender, { supabase, instanceName: instance_name });
    const updates: Record<string, any> = {};

    // Persistir insights da IA no customer
    if (decision.pain_point) updates.pain_point = String(decision.pain_point).slice(0, 200);
    if (typeof decision.qualification_score === "number") {
      updates.qualification_score = decision.qualification_score;
    }
    updates.intent_signals = {
      last_intent: decision.detected_intent,
      objection_type: decision.objection_type || null,
      confidence: decision.confidence,
      at: new Date().toISOString(),
    };

    // Handoff
    if (decision.handoff) {
      updates.bot_paused = true;
      updates.bot_paused_reason = decision.handoff_reason || "ia_decidiu";
      updates.bot_paused_at = new Date().toISOString();
      updates.conversation_step = "handoff_humano";
    } else if (decision.next_step && decision.next_step !== stepBefore) {
      updates.conversation_step = decision.next_step;
    }

    // Pausa humanizadora antes de enviar (se IA pediu)
    const extraPauseMs = Math.max(0, Math.min(8, decision.should_pause_seconds || 0)) * 1000;
    if (extraPauseMs > 0) await sleep(extraPauseMs);

    // Simulação de digitação
    const typingMin = config.typing_min_ms ?? 1200;
    const typingMax = config.typing_max_ms ?? 3500;

    // 10a) Resolver e enviar áudio do slot (Camila) — prioridade: personal → public → fallback_text
    let dispatchedSlot: { slot_key: string; variant: string; media_id: string | null } | null = null;
    let slotKey = (decision.audio_slot_key || "").trim();

    // 🔒 REGRA DETERMINÍSTICA: primeiro contato (zero outbound prévio) sempre dispara "boas_vindas".
    // Independe da decisão da LLM — garante que o áudio inicial sempre seja enviado.
    const hadOutboundBefore = historyChrono.some((m: any) => m.message_direction === "outbound");
    if (!hadOutboundBefore && validSlotKeys.has("boas_vindas")) {
      slotKey = "boas_vindas";
      // Limpa reply_text para não duplicar a abertura — o áudio já cumprimenta.
      decision.reply_text = "";
    }

    // 🎯 FLUXO Q&A: casa pergunta do cliente com respostas pré-cadastradas em bot_flow_qa.
    try {
      const { data: activeFlow } = await supabase
        .from("bot_flows")
        .select("id, strict_mode")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .maybeSingle();
      if (activeFlow) {
        const { data: qas } = await supabase
          .from("bot_flow_qa")
          .select("id, intent_name, is_opening, is_closing, text_response")
          .eq("flow_id", (activeFlow as any).id)
          .order("position");
        const qaList = (qas as any[]) || [];

        const norm = (s: string) =>
          (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const inputN = norm(user_input || "");

        let matched: any = null;
        // 1) Abertura no primeiro contato
        if (!hadOutboundBefore) {
          matched = qaList.find((q) => q.is_opening);
        }
        // 2) Match por trigger phrase
        if (!matched && inputN) {
          const ids = qaList.filter((q) => !q.is_opening).map((q) => q.id);
          if (ids.length) {
            const { data: trigs } = await supabase
              .from("bot_flow_qa_triggers")
              .select("qa_id, phrase")
              .in("qa_id", ids);
            for (const t of (trigs as any[]) || []) {
              if (inputN.includes(norm(t.phrase))) {
                matched = qaList.find((q) => q.id === t.qa_id);
                if (matched) break;
              }
            }
          }
        }

        if (matched) {
          const { data: meds } = await supabase
            .from("bot_flow_qa_media")
            .select("media_kind, slot_key, media_id")
            .eq("qa_id", matched.id)
            .order("position");
          const orderedMedia = (meds as any[] || []);
          const firstSlot = orderedMedia.find((m) => m.media_kind === "audio" && m.slot_key && validSlotKeys.has(m.slot_key));
          const selectedMediaIds = orderedMedia
            .filter((m) => m.media_id)
            .map((m) => String(m.media_id));
          if ((activeFlow as any).strict_mode || !hadOutboundBefore) {
            if (selectedMediaIds.length) decision.media_to_send_ids = selectedMediaIds;
            if (firstSlot) {
              slotKey = firstSlot.slot_key;
              decision.reply_text = "";
            }
            if (matched.text_response) {
              const link = `https://igreenenergybrasil.site/${(customer as any).consultant_license || ""}/cadastro`;
              decision.reply_text = String(matched.text_response)
                .replaceAll("{nome}", customer.name || "")
                .replaceAll("{link_cadastro}", link);
              if (firstSlot) decision.reply_text = ""; // não duplica abertura quando há áudio
              else if (matched.is_closing) {
                decision.reply_text = String(matched.text_response)
                  .replaceAll("{nome}", customer.name || "")
                  .replaceAll("{link_cadastro}", link);
              }
            }
          } else if (firstSlot) {
            // Modo sugestão: usa slot quando bate intenção, mas mantém reply do LLM
            slotKey = firstSlot.slot_key;
            if (selectedMediaIds.length) decision.media_to_send_ids = selectedMediaIds;
          } else if (selectedMediaIds.length) {
            decision.media_to_send_ids = selectedMediaIds;
          }
        }
      }
    } catch (e) {
      console.warn("Q&A flow resolve failed:", (e as any)?.message);
    }


    if (slotKey) {
      // Validação: slot_key inexistente -> log e ignora
      if (!validSlotKeys.has(slotKey)) {
        await supabase.from("ai_slot_dispatch_log").insert({
          consultant_id: consultantId, customer_id, slot_key: slotKey,
          media_id: null, variant: "invalid", dispatch_status: "blocked_invalid_slot",
        });
        console.warn(`slot_key inválido escolhido pela IA: ${slotKey}`);
      } else {
        const slot = slots.find((s: any) => s.slot_key === slotKey);
        // Trava global: máx 3 áudios por cliente em 24h
        const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
        const { data: last24 } = await supabase
          .from("ai_slot_dispatch_log")
          .select("id, sent_at")
          .eq("customer_id", customer_id)
          .eq("dispatch_status", "sent")
          .gte("sent_at", since24h)
          .order("sent_at", { ascending: false });
        const sentCount24h = (last24 || []).length;
        const lastSentAt = last24?.[0]?.sent_at ? new Date(last24[0].sent_at).getTime() : 0;
        // Mín 5 minutos entre quaisquer dois áudios pro mesmo cliente
        const tooSoonGlobal = lastSentAt && (Date.now() - lastSentAt) < 5 * 60_000;
        const overGlobalLimit = sentCount24h >= 3;

        // Cooldown por slot — boas_vindas tem idempotência ETERNA por cliente
        const isWelcome = slotKey === "boas_vindas";
        const cutoff = isWelcome
          ? new Date(0).toISOString()
          : new Date(Date.now() - (slot.min_interval_minutes || 0) * 60_000).toISOString();
        const { data: recent } = await supabase
          .from("ai_slot_dispatch_log")
          .select("id")
          .eq("customer_id", customer_id)
          .eq("slot_key", slotKey)
          .eq("dispatch_status", "sent")
          .gte("sent_at", cutoff)
          .limit(1);
        const onCooldown = (recent || []).length > 0;

        if (overGlobalLimit || tooSoonGlobal) {
          await supabase.from("ai_slot_dispatch_log").insert({
            consultant_id: consultantId, customer_id, slot_key: slotKey,
            media_id: null, variant: "blocked", dispatch_status: "blocked_global_limit",
          });
          console.log(`slot ${slotKey} bloqueado por limite global (24h=${sentCount24h}, tooSoon=${tooSoonGlobal})`);
        } else if (onCooldown) {
          await supabase.from("ai_slot_dispatch_log").insert({
            consultant_id: consultantId, customer_id, slot_key: slotKey,
            media_id: null, variant: "blocked", dispatch_status: "blocked_cooldown",
          });
          console.log(`slot ${slotKey} on cooldown, skipping`);
        } else if (slot.is_testing) {
          // Modo teste: não envia, só registra
          await supabase.from("ai_slot_dispatch_log").insert({
            consultant_id: consultantId, customer_id, slot_key: slotKey,
            media_id: null, variant: "testing", dispatch_status: "testing_only",
          });
          console.log(`slot ${slotKey} em modo teste — não enviado`);
        } else {
          // Busca TODAS as mídias personal ativas do slot, em ordem de envio.
          // Suporta múltiplas mídias por passo (ex.: 1 áudio + 1 imagem + 1 vídeo),
          // cada uma com seu próprio delay_before_ms.
          const { data: personalList } = await supabase
            .from("ai_media_library")
            .select("id, kind, url, label, delay_before_ms, send_order")
            .eq("consultant_id", consultantId)
            .eq("slot_key", slotKey)
            .eq("active", true)
            .eq("is_draft", false)
            .order("send_order", { ascending: true });

          let toSend: Array<{ id: string | null; kind: string; url: string; label?: string | null; delay_before_ms?: number | null; variant: string }> = [];
          if (personalList && personalList.length) {
            toSend = (personalList as any[]).map((p) => ({
              id: p.id, kind: p.kind || "audio", url: p.url, label: p.label,
              delay_before_ms: p.delay_before_ms, variant: "personal",
            }));
          } else {
            const { data: pubList } = await supabase
              .from("ai_media_library")
              .select("id, kind, url, label, delay_before_ms, send_order")
              .eq("is_public", true)
              .eq("slot_key", slotKey)
              .eq("active", true)
              .order("send_order", { ascending: true });
            if (pubList && pubList.length) {
              toSend = (pubList as any[]).map((p) => ({
                id: p.id, kind: p.kind || "audio", url: p.url, label: p.label,
                delay_before_ms: p.delay_before_ms, variant: "default",
              }));
            }
          }

          try {
            if (toSend.length) {
              for (let i = 0; i < toSend.length; i++) {
                const m = toSend[i];
                // Atraso configurado pelo consultor antes de cada mídia (default 1.5s).
                // Se 0, ainda respeita o typing min para não atropelar.
                const delayMs = (m.delay_before_ms ?? 1500);
                if (i === 0) {
                  await sleep(Math.max(delayMs, randInt(typingMin, typingMax)));
                } else {
                  await sleep(Math.max(delayMs, 800));
                }
                if (m.kind === "audio") {
                  await sender.sendAudio(remote_jid, m.url);
                } else if (m.kind === "video" || m.kind === "image" || m.kind === "document") {
                  await sender.sendMedia(remote_jid, m.url, m.label || "", m.kind);
                } else if (m.kind === "text") {
                  await sender.sendText(remote_jid, m.label || "");
                } else {
                  await sender.sendMedia(remote_jid, m.url, m.label || "", m.kind);
                }
                dispatchedSlot = { slot_key: slotKey, variant: m.variant, media_id: m.id };
                await supabase.from("conversations").insert({
                  customer_id, message_direction: "outbound",
                  message_text: `[${m.kind}:${slotKey}]`, message_type: m.kind,
                  conversation_step: updates.conversation_step || stepBefore,
                });
                if (m.id) {
                  const { data: cur } = await supabase
                    .from("ai_media_library").select("sent_count").eq("id", m.id).single();
                  if (cur) {
                    await supabase.from("ai_media_library")
                      .update({ sent_count: (cur.sent_count || 0) + 1 })
                      .eq("id", m.id);
                  }
                }
              }
              // Vídeo extra do slot (legado: ai_agent_slots.video_url) só envia se
              // não houver vídeo na lista personal (evita duplicar)
              const hasVideoInList = toSend.some((m) => m.kind === "video");
              if (slot.video_url && !hasVideoInList) {
                try {
                  await sleep(randInt(typingMin, typingMax));
                  await sender.sendMedia(remote_jid, slot.video_url, slot.video_label || "", "video");
                  await supabase.from("conversations").insert({
                    customer_id, message_direction: "outbound",
                    message_text: `[video:${slotKey}] ${slot.video_label || ""}`.trim(),
                    message_type: "video",
                    conversation_step: updates.conversation_step || stepBefore,
                  });
                } catch (e) {
                  console.error("slot video send error:", e);
                }
              }
            } else if (slot.fallback_text) {
              await sender.sendText(remote_jid, slot.fallback_text);
              dispatchedSlot = { slot_key: slotKey, variant: "fallback_text", media_id: null };
              await supabase.from("conversations").insert({
                customer_id, message_direction: "outbound",
                message_text: slot.fallback_text, message_type: "text",
                conversation_step: updates.conversation_step || stepBefore,
              });
            }
            if (dispatchedSlot) {
              await supabase.from("ai_slot_dispatch_log").insert({
                consultant_id: consultantId,
                customer_id,
                slot_key: slotKey,
                media_id: dispatchedSlot.media_id,
                variant: dispatchedSlot.variant,
                dispatch_status: "sent",
              });
            }
          } catch (e) {
            console.error("slot send error:", e);
          }
        }
      }
    }

    // Se um slot foi despachado, suprime reply_text para não duplicar a fala do áudio
    if (dispatchedSlot) {
      decision.reply_text = "";
      // Avanço determinístico após boas_vindas
      if (dispatchedSlot.slot_key === "boas_vindas" && stepBefore === "welcome") {
        updates.conversation_step = "qualificacao";
      }
    }

    // Auto-progresso determinístico (não depende do LLM)
    const hasBill = !!customer.electricity_bill_value;
    const hasDoc = !!customer.cpf && (!!customer.rg || !!customer.birth_date);
    if (user_input_kind === "image_caption" || user_input_kind === "document") {
      if (["welcome", "qualificacao", "apresentacao"].includes(updates.conversation_step || stepBefore)) {
        // 📸 FIX (cadastro completo na IA livre): a foto recebida vira a CONTA
        // DE LUZ e o turno é entregue ao pipeline determinístico REAL
        // ("aguardando_conta" → OCR → confirma → doc → e-mail → telefone →
        // portal). Antes ia para "coleta_conta", um passo FANTASMA que nenhum
        // handler processa — a IA "engolia" a foto e o cadastro travava.
        updates.conversation_step = "aguardando_conta";
      }
    }
    // 🔁 PONTE DE PASSOS-FANTASMA → PIPELINE REAL: se o LLM decidiu avançar para
    // um passo de coleta que não existe na máquina determinística, traduz para o
    // passo REAL equivalente, para que o cadastro siga até o fim.
    const _ghostToReal: Record<string, string> = {
      coleta_conta: "aguardando_conta",
      coleta_doc: "ask_tipo_documento",
      coleta_dados: "ask_name",
    };
    const _proposedStep = updates.conversation_step || stepBefore;
    if (_ghostToReal[_proposedStep]) {
      updates.conversation_step = _ghostToReal[_proposedStep];
    }
    if (hasBill && hasDoc && !["cadastro_portal", "aguardando_otp", "aguardando_facial", "complete", "handoff_humano"].includes(updates.conversation_step || stepBefore)) {
      // Funil obrigatório: INTERESSE → CONTA → DOCUMENTO → E-MAIL → telefone →
      // só então PORTAL/OTP. `getNextMissingStep` decide sem pular etapa —
      // antes bastava valor+cpf e o portal disparava sem doc/e-mail reais.
      try {
        const { getNextMissingStep } = await import("../_shared/conversation-helpers.ts");
        const { resolvePortalGate } = await import("../_shared/bot/cadastro-fixes.ts");
        const { data: _consultorEmailRow } = await supabase
          .from("consultants").select("email").eq("id", consultantId).maybeSingle();
        const gate = resolvePortalGate(
          getNextMissingStep(customer, { consultorEmail: (_consultorEmailRow as any)?.email ?? null }),
        );
        if (gate.action === "portal") {
          updates.conversation_step = "cadastro_portal";
          (async () => {
            try {
              const { dispatchPortalWorker } = await import("../_shared/portal-worker.ts");
              await dispatchPortalWorker(supabase, customer_id);
            } catch (e: any) {
              console.error("portal worker dispatch error:", e?.message);
            }
          })().catch(() => {});
        } else {
          updates.conversation_step = gate.step;
          console.log(`[ai-agent-router] portal-gate: falta ${gate.step} — sem pular etapa`);
        }
      } catch (e: any) {
        console.warn("[ai-agent-router] portal-gate falhou (mantém passo atual):", e?.message);
      }
    }

    // Enviar mídias primeiro (mais humano: áudio chega antes do texto)
    const sentMediaIds: string[] = [];
    for (const mediaId of (decision.media_to_send_ids || []).slice(0, 3)) {
      const m = (mediaLibrary || []).find((x: any) => x.id === mediaId);
      if (!m || !m.url) continue;
      try {
        await sleep(randInt(typingMin, typingMax));
        if (m.kind === "audio") {
          await sender.sendAudio(remote_jid, m.url);
        } else if (m.kind === "image") {
          await sender.sendMedia(remote_jid, m.url, "", "image");
        } else if (m.kind === "video") {
          await sender.sendMedia(remote_jid, m.url, "", "video");
        } else if (m.kind === "document") {
          await sender.sendMedia(remote_jid, m.url, m.label || "", "document");
        } else if (m.kind === "text" && m.text_content) {
          await sender.sendText(remote_jid, m.text_content);
        }
        sentMediaIds.push(mediaId);
        // log outbound
        await supabase.from("conversations").insert({
          customer_id, message_direction: "outbound",
          message_text: `[${m.kind}] ${m.label}`, message_type: m.kind,
          conversation_step: updates.conversation_step || stepBefore,
        });
      } catch (e) {
        console.error("media send error:", e);
      }
    }

    // Enviar texto
    if (decision.reply_text && decision.reply_text.trim()) {
      await sleep(randInt(typingMin, typingMax));
      await sender.sendText(remote_jid, decision.reply_text.trim());
      await supabase.from("conversations").insert({
        customer_id, message_direction: "outbound",
        message_text: decision.reply_text.trim(), message_type: "text",
        conversation_step: updates.conversation_step || stepBefore,
      });
    }

    // 11) Persistir updates
    updates.last_bot_reply_at = new Date().toISOString();
    if (Object.keys(updates).length > 0) {
      await supabase.from("customers").update(updates).eq("id", customer_id);
    }

    // 12) Log
    await supabase.from("ai_agent_logs").insert({
      consultant_id: consultantId,
      customer_id,
      phone: customer.phone_whatsapp,
      step_before: stepBefore,
      step_after: updates.conversation_step || stepBefore,
      user_input: lastInboundLabel.slice(0, 2000),
      user_input_kind,
      llm_output: decision,
      media_sent_id: sentMediaIds[0] || null,
      handoff: !!decision.handoff,
      handoff_reason: decision.handoff_reason || null,
      latency_ms: Date.now() - t0,
      error: llmError,
    });

    return new Response(JSON.stringify({ ok: true, decision, sent_media_ids: sentMediaIds }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-agent-router error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});