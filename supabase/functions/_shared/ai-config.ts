// AI Config — perfis e seleção de modelo central.
//
// Ponto único onde decidimos qual modelo de IA usar para cada tarefa.
// Antes desta camada, cada Edge Function escolhia seu próprio modelo
// (gemini-2.0-flash em intent-classifier, gemini-2.5-flash no
// conversational, gpt-5-mini em outro lugar) — sem coordenação. Quando
// quiséssemos atualizar para a próxima geração de modelos, eram dezenas
// de pontos a tocar.
//
// Aqui definimos:
//   - perfis (`accuracy` / `balanced` / `fast`) que mapeiam para par
//     {primary, fallback} via provider (Google ou OpenAI)
//   - tasks bem-definidas (intent_classify, faq_answer, sales_decide,
//     button_intent, fallback_decide, ocr_validate, etc.)
//   - função `pickModel(task, profile, provider)` que retorna o
//     modelo a usar
//
// Override por consultor: `consultants.ai_profile` aceita
// 'accuracy' | 'balanced' | 'fast' (default 'balanced'). Tarefas
// individuais podem ser sobrescritas via env `AI_PROFILE_OVERRIDE_<TASK>`.
//
// Política de evolução: quando sair Gemini 4 ou GPT-6, atualizamos só
// este arquivo. Toda Edge Function passa pelas funções aqui.

export type AiProvider = "google" | "openai";
export type AiProfile = "accuracy" | "balanced" | "fast";

/**
 * Tarefas bem-definidas onde o sistema chama IA.
 * Cada tarefa tem requisitos diferentes de latência/precisão/custo.
 */
export type AiTask =
  // Roteamento e classificação (latência crítica, precisão razoável)
  | "intent_classify"        // identificar intent do lead (afirmacao/negacao/pergunta...)
  | "button_intent"          // mapear texto livre para botão visível
  // Conhecimento e respostas (precisão > latência)
  | "faq_answer"             // responder pergunta do lead com base de conhecimento
  | "duvida_handler"         // responder dúvidas livres no fluxo (passo 6 do D)
  | "knowledge_synthesis"    // sumarizar/explicar tópico complexo
  // Decisão de fluxo (precisão alta, latência ok)
  | "sales_decide"           // decidir próximo passo do fluxo (objeção, fechamento)
  | "fallback_decide"        // escolher próximo step quando nada bate
  // Geração de conteúdo (alta qualidade)
  | "step_text_generate"     // gerar texto persuasivo de step
  | "ad_copy_generate"       // gerar copy de anúncio
  // OCR e validação (multimodal)
  | "ocr_extract"            // extrair dados estruturados de imagem
  | "ocr_validate"           // validar consistência do OCR
  | "image_qa"               // QA de imagem para anúncios
  // Análise interna (não-tempo-real)
  | "health_intel"           // análise de saúde do bot
  | "captacao_intel";        // análise de captação

/**
 * Tabela de modelos por (perfil × provider × tarefa).
 *
 * Convenção:
 *   - **accuracy** usa o modelo mais avançado (Gemini 3.1 Pro / GPT-5.5).
 *   - **balanced** usa Flash de geração atual (Gemini 3.5 Flash / GPT-5-mini).
 *   - **fast** usa o modelo mais leve disponível (Gemini 2.5 Flash-Lite / GPT-5-nano).
 *
 * Quando o modelo primário falha (429, timeout, indisponível), o caller
 * cai pro fallback do mesmo perfil (ou um nível abaixo).
 */
const MODEL_MATRIX: Record<AiProfile, Record<AiProvider, Record<string, { primary: string; fallback: string }>>> = {
  accuracy: {
    google: {
      // Roteamento — accuracy usa Pro mas com latência aceitável
      intent_classify:      { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      button_intent:        { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      // Respostas — a precisão é o que mais importa aqui
      faq_answer:           { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      duvida_handler:       { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      knowledge_synthesis:  { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      // Decisões críticas
      sales_decide:         { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      fallback_decide:      { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      // Geração
      step_text_generate:   { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      ad_copy_generate:     { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      // OCR
      ocr_extract:          { primary: "gemini-3.1-pro",   fallback: "gemini-2.5-pro" },
      ocr_validate:         { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      image_qa:             { primary: "gemini-3.1-pro",   fallback: "gemini-2.5-pro" },
      // Análises
      health_intel:         { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      captacao_intel:       { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
    },
    openai: {
      intent_classify:      { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      button_intent:        { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      faq_answer:           { primary: "gpt-5.5",          fallback: "gpt-5" },
      duvida_handler:       { primary: "gpt-5.5",          fallback: "gpt-5" },
      knowledge_synthesis:  { primary: "gpt-5.5",          fallback: "gpt-5" },
      sales_decide:         { primary: "gpt-5.5",          fallback: "gpt-5" },
      fallback_decide:      { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      step_text_generate:   { primary: "gpt-5.5",          fallback: "gpt-5" },
      ad_copy_generate:     { primary: "gpt-5.5",          fallback: "gpt-5" },
      ocr_extract:          { primary: "gpt-5.5",          fallback: "gpt-5" },
      ocr_validate:         { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      image_qa:             { primary: "gpt-5.5",          fallback: "gpt-5" },
      health_intel:         { primary: "gpt-5.5",          fallback: "gpt-5" },
      captacao_intel:       { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
    },
  },
  balanced: {
    google: {
      // PREMIUM upgrade: balanced agora usa Pro para classificação de intent
      intent_classify:      { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      button_intent:        { primary: "gemini-3.1-pro",   fallback: "gemini-3.5-flash" },
      faq_answer:           { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      duvida_handler:       { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      knowledge_synthesis:  { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      sales_decide:         { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      fallback_decide:      { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash-lite" },
      step_text_generate:   { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      ad_copy_generate:     { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      ocr_extract:          { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      ocr_validate:         { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash-lite" },
      image_qa:             { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      health_intel:         { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
      captacao_intel:       { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash-lite" },
    },
    openai: {
      // PREMIUM upgrade: balanced openai sobe para gpt-5 na classificação
      intent_classify:      { primary: "gpt-5",            fallback: "gpt-5-mini" },
      button_intent:        { primary: "gpt-5",            fallback: "gpt-5-mini" },
      faq_answer:           { primary: "gpt-5",            fallback: "gpt-5-mini" },
      duvida_handler:       { primary: "gpt-5",            fallback: "gpt-5-mini" },
      knowledge_synthesis:  { primary: "gpt-5",            fallback: "gpt-5-mini" },
      sales_decide:         { primary: "gpt-5",            fallback: "gpt-5-mini" },
      fallback_decide:      { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      step_text_generate:   { primary: "gpt-5",            fallback: "gpt-5-mini" },
      ad_copy_generate:     { primary: "gpt-5",            fallback: "gpt-5-mini" },
      ocr_extract:          { primary: "gpt-5",            fallback: "gpt-5-mini" },
      ocr_validate:         { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      image_qa:             { primary: "gpt-5",            fallback: "gpt-5-mini" },
      health_intel:         { primary: "gpt-5",            fallback: "gpt-5-mini" },
      captacao_intel:       { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
    },
  },
  fast: {
    google: {
      intent_classify:      { primary: "gemini-2.5-flash-lite", fallback: "gemini-2.5-flash" },
      button_intent:        { primary: "gemini-2.5-flash-lite", fallback: "gemini-2.5-flash" },
      faq_answer:           { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      duvida_handler:       { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      knowledge_synthesis:  { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      sales_decide:         { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      fallback_decide:      { primary: "gemini-2.5-flash-lite", fallback: "gemini-2.5-flash" },
      step_text_generate:   { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      ad_copy_generate:     { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      ocr_extract:          { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      ocr_validate:         { primary: "gemini-2.5-flash-lite", fallback: "gemini-2.5-flash" },
      image_qa:             { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      health_intel:         { primary: "gemini-2.5-flash",      fallback: "gemini-2.5-flash-lite" },
      captacao_intel:       { primary: "gemini-2.5-flash-lite", fallback: "gemini-2.5-flash" },
    },
    openai: {
      intent_classify:      { primary: "gpt-5-nano",       fallback: "gpt-5-mini" },
      button_intent:        { primary: "gpt-5-nano",       fallback: "gpt-5-mini" },
      faq_answer:           { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      duvida_handler:       { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      knowledge_synthesis:  { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      sales_decide:         { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      fallback_decide:      { primary: "gpt-5-nano",       fallback: "gpt-5-mini" },
      step_text_generate:   { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      ad_copy_generate:     { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      ocr_extract:          { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      ocr_validate:         { primary: "gpt-5-nano",       fallback: "gpt-5-mini" },
      image_qa:             { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      health_intel:         { primary: "gpt-5-mini",       fallback: "gpt-5-nano" },
      captacao_intel:       { primary: "gpt-5-nano",       fallback: "gpt-5-mini" },
    },
  },
};

/**
 * Seleciona o modelo (primário + fallback) para uma combinação
 * (tarefa, perfil, provider).
 *
 * Override via env: defina `AI_MODEL_OVERRIDE_<TASK>=model-name` para
 * forçar um modelo específico em uma tarefa, ignorando perfil. Útil
 * para testes A/B e mitigação de incidentes ("a versão X do Gemini
 * tá quebrada, força volta pra Y por 2 horas").
 *
 * @param task Tarefa específica
 * @param profile Perfil de qualidade desejado
 * @param provider Provedor de IA
 */
export function pickModel(
  task: AiTask,
  profile: AiProfile = "balanced",
  provider: AiProvider = "google",
): { primary: string; fallback: string } {
  // Env override (mitigação de incidente)
  const override = (typeof Deno !== "undefined" && Deno.env)
    ? Deno.env.get(`AI_MODEL_OVERRIDE_${task.toUpperCase()}`)
    : undefined;
  if (override && override.trim()) {
    return { primary: override.trim(), fallback: override.trim() };
  }
  const tableEntry = MODEL_MATRIX[profile]?.[provider]?.[task];
  if (tableEntry) return tableEntry;
  // Defensivo: tarefa não mapeada → cai pro balanced/google flash
  return { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" };
}

/**
 * Configuração GLOBAL de IA definida pelo Superadmin (tabela `settings`).
 * Estas chaves, quando presentes, têm PRECEDÊNCIA sobre o ajuste por consultor
 * — o pedido é "configuração só do superadmin". O painel que grava é
 * `src/components/superadmin/AIControlPanel.tsx`.
 *
 * Cache de 60s em memória (igual ao de perfil). Falha de leitura → tudo null,
 * e o caller cai no comportamento por consultor / default (fail-safe).
 */
export interface GlobalAiSettings {
  profile: AiProfile | null;
  provider: AiProvider | null;
  kbOnly: boolean | null;
  audioTranscribe: boolean | null;
}

const GLOBAL_SETTINGS_KEYS = [
  "ai_profile_global",
  "ai_provider_global",
  "ai_kb_only_mode",
  "ai_audio_transcribe",
] as const;

let _globalSettingsCache: { value: GlobalAiSettings; t: number } | null = null;
const GLOBAL_TTL_MS = 60_000;

function parseBool(raw: string | undefined | null): boolean | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}

export async function getGlobalAiSettings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<GlobalAiSettings> {
  if (_globalSettingsCache && Date.now() - _globalSettingsCache.t < GLOBAL_TTL_MS) {
    return _globalSettingsCache.value;
  }
  const empty: GlobalAiSettings = { profile: null, provider: null, kbOnly: null, audioTranscribe: null };
  try {
    const { data } = await supabase
      .from("settings")
      .select("key,value")
      .in("key", GLOBAL_SETTINGS_KEYS as unknown as string[]);
    const map: Record<string, string> = {};
    for (const r of (data || [])) map[String((r as any).key)] = String((r as any).value ?? "");
    const rawP = String(map.ai_profile_global || "").toLowerCase();
    const rawPr = String(map.ai_provider_global || "").toLowerCase();
    const value: GlobalAiSettings = {
      profile: rawP === "accuracy" || rawP === "fast" || rawP === "balanced" ? (rawP as AiProfile) : null,
      provider: rawPr === "openai" ? "openai" : rawPr === "google" ? "google" : null,
      kbOnly: parseBool(map.ai_kb_only_mode),
      audioTranscribe: parseBool(map.ai_audio_transcribe),
    };
    _globalSettingsCache = { value, t: Date.now() };
    return value;
  } catch (_) {
    return empty;
  }
}

export function clearGlobalAiSettingsCache() {
  _globalSettingsCache = null;
}

/**
 * Lê o perfil de IA a aplicar. PRECEDÊNCIA: global do Superadmin
 * (`settings.ai_profile_global`) > `consultants.ai_profile` > default 'balanced'.
 * Cache de 60s em memória — leituras consecutivas evitam round-trip.
 */
const _profileCache = new Map<string, { profile: AiProfile; t: number }>();
const PROFILE_TTL_MS = 60_000;

export async function getConsultantAiProfile(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  consultantId: string,
): Promise<AiProfile> {
  // 1) Global do Superadmin vence quando definido.
  try {
    const global = await getGlobalAiSettings(supabase);
    if (global.profile) return global.profile;
  } catch (_) { /* fail-safe: segue para o por-consultor */ }

  // 2) Por consultor (com cache).
  const cached = _profileCache.get(consultantId);
  if (cached && Date.now() - cached.t < PROFILE_TTL_MS) return cached.profile;
  try {
    const { data } = await supabase
      .from("consultants")
      .select("ai_profile")
      .eq("id", consultantId)
      .maybeSingle();
    const raw = String((data as any)?.ai_profile || "balanced").toLowerCase();
    const profile: AiProfile =
      raw === "accuracy" || raw === "fast" ? raw : "balanced";
    _profileCache.set(consultantId, { profile, t: Date.now() });
    return profile;
  } catch (_) {
    return "balanced";
  }
}

export function clearAiProfileCache() {
  _profileCache.clear();
}

/**
 * Lê `consultants.ai_provider_pref` para descobrir provedor preferido.
 * Default 'google' (mais barato e GA estável).
 */
export async function getConsultantAiProvider(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  consultantId: string,
): Promise<AiProvider> {
  // Global do Superadmin vence quando definido.
  try {
    const global = await getGlobalAiSettings(supabase);
    if (global.provider) return global.provider;
  } catch (_) { /* fail-safe */ }
  try {
    const { data } = await supabase
      .from("consultants")
      .select("ai_provider_pref")
      .eq("id", consultantId)
      .maybeSingle();
    const raw = String((data as any)?.ai_provider_pref || "google").toLowerCase();
    return raw === "openai" ? "openai" : "google";
  } catch (_) {
    return "google";
  }
}
