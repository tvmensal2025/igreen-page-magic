// Task 21 (whatsapp-flow-reliability-fix): resolve dinamicamente o step de
// captura de imagem de conta de luz dentro do flow do consultor. Permite que
// um consultor renomeie o step (ex: "capturar_conta_v2") ou tenha múltiplos
// flows, sem precisar de patch no código. Fallback: "aguardando_conta".
//
// O helper é deliberadamente best-effort + tolerante a erro. Em qualquer
// falha (RLS, flow inexistente, sem step de captura) retorna o legado.
//
// Blindagem B (cadastro nunca fica perdido): o construtor visual gera passos
// com `step_type = 'capture_conta'` / `'capture_documento'` (chaves
// `passo_xxx`), NÃO `'image_capture'`. Por isso o resolver reconhece as duas
// formas e SEMPRE devolve a chave CANÔNICA do pipeline determinístico
// (`aguardando_conta` / `aguardando_doc_auto`) — nunca a chave custom, que
// roteia de volta pro motor conversacional e trava o lead.

const FALLBACK = "aguardando_conta";

// Chave canônica do pipeline de OCR por tipo de captura. Mantém o lead no
// engine `sys` (bot-flow.ts), onde o OCR realmente roda.
const CANONICAL_BILL = "aguardando_conta";
const CANONICAL_DOC = "aguardando_doc_auto";

// step_types do construtor visual que disparam OCR.
const BILL_TYPES = new Set(["image_capture", "capture_conta"]);
const DOC_TYPES = new Set(["capture_documento", "capture_doc"]);

// Cache curto (60s) por consultor — flows mudam raro e queremos zero overhead
// no hot path do webhook.
const cache = new Map<string, { value: string; expiresAt: number }>();
const TTL_MS = 60_000;

export async function resolveImageCaptureStep(
  supabase: any,
  consultantId: string | null | undefined,
): Promise<string> {
  if (!consultantId) return FALLBACK;

  const cached = cache.get(consultantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const { data: flow } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!flow?.id) {
      cache.set(consultantId, { value: FALLBACK, expiresAt: Date.now() + TTL_MS });
      return FALLBACK;
    }

    // Procura um passo de captura de conta (image_capture legado OU capture_conta
    // do construtor visual). Se existir, devolve a chave CANÔNICA do pipeline
    // (não a chave custom) — assim o turno seguinte roda OCR de verdade.
    const { data: step } = await supabase
      .from("bot_flow_steps")
      .select("step_type")
      .eq("flow_id", flow.id)
      .in("step_type", ["image_capture", "capture_conta"])
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    const value = step ? CANONICAL_BILL : FALLBACK;
    cache.set(consultantId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (_e) {
    return FALLBACK;
  }
}

/**
 * Blindagem B: dado o passo ATUAL do lead (id UUID ou step_key custom),
 * decide para qual passo canônico do pipeline de OCR redirecionar quando
 * chega uma mídia. Distingue conta x documento pelo `step_type` do passo.
 *
 * Retorna:
 *  - "aguardando_conta"      quando o passo atual é de captura de conta;
 *  - "aguardando_doc_auto"   quando é de captura de documento;
 *  - null                    quando o passo atual NÃO é um passo de captura
 *                            (deixa o chamador usar a heurística genérica).
 *
 * Best-effort: qualquer erro → null (chamador segue com o comportamento atual).
 */
export async function resolveCaptureRedirectStep(
  supabase: any,
  consultantId: string | null | undefined,
  currentStepRaw: string | null | undefined,
): Promise<string | null> {
  const stepRef = String(currentStepRaw || "").replace(/^flow:/, "").trim();
  if (!stepRef || !consultantId) return null;
  // Chaves canônicas já são tratadas pelo bot-flow direto — não interceptamos.
  if (stepRef === CANONICAL_BILL || stepRef === CANONICAL_DOC) return null;

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stepRef);
    const { data: step } = await supabase
      .from("bot_flow_steps")
      .select("step_type")
      .eq(isUuid ? "id" : "step_key", stepRef)
      .limit(1)
      .maybeSingle();

    const stepType = String((step as any)?.step_type || "");
    if (BILL_TYPES.has(stepType)) return CANONICAL_BILL;
    if (DOC_TYPES.has(stepType)) return CANONICAL_DOC;
    return null;
  } catch (_e) {
    return null;
  }
}

/** Apenas para testes — limpa o cache. */
export function _clearImageCaptureCache() {
  cache.clear();
}
