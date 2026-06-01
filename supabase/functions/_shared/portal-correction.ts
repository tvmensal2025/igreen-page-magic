// Portal 2 (autoconexao) — Loop de correção via WhatsApp: helpers PUROS.
//
// Módulo PURO (sem I/O, sem dependências de Deno/Supabase) com toda a lógica
// determinística do loop de correção do `bot-flow.ts` (evolution + whapi):
//   - validação de formato do dado corrigido (telefone/email/instalação);
//   - normalização anti-repetição (Req 9.1) — telefone/instalação só dígitos,
//     email trim+lowercase;
//   - decisão de limite de tentativas por classe (Req 9.5/9.6, limite = 3);
//   - mapeamento Classe_de_Erro → step + campo + mensagem (design §5.1);
//   - guarda de não-recuperável / limite esgotado (Req 10.4);
//   - mascaramento de PII para logs (Req 12.4).
//
// É importado tanto pelo handler evolution (`evolution-webhook/handlers/bot-flow.ts`)
// quanto pelo espelho whapi (`whapi-webhook/handlers/bot-flow.ts`) e pelos testes
// de propriedade. Mantê-lo PURO garante que a lógica seja idêntica entre os dois
// canais e facilmente testável sem mocks de banco.
//
// Espelha as Classes de Erro definidas em `worker-portal-2/portal-errors.mjs`.
// Documentação: .kiro/specs/portal2-ocr-feedback-loop/design.md (seções 5.1–5.5).

// ─── Limite de correção (Req 9.6) ───────────────────────────────────────────
/** Número máximo de re-despachos por Classe_de_Erro por cadastro. */
export const CORRECTION_LIMIT = 3;

// ─── Classes recuperáveis tratadas por step de correção (design §5.1) ────────
// `missing_consumo` é recuperável, mas é auto-corrigido inline no step
// `portal_submitting` (não tem step `corrigir_*`), por isso não entra aqui.
export type CorrectionKind =
  | "duplicate_phone"
  | "duplicate_email"
  | "duplicate_installation";

export const RECOVERABLE_CORRECTION_KINDS: ReadonlySet<string> = new Set<string>([
  "duplicate_phone",
  "duplicate_email",
  "duplicate_installation",
]);

/** Especificação de um step de correção: para onde ir, qual campo gravar, o que perguntar. */
export interface CorrectionStepSpec {
  /** valor de `conversation_step` do step de correção */
  step: string;
  /** coluna de `customers` onde o novo valor é persistido */
  field: string;
  /** mensagem enviada ao cliente pedindo o dado novo (textos do design §5.1) */
  prompt: string;
}

/**
 * Mapa Classe_de_Erro → step/campo/mensagem (design §5.1).
 * Os textos em português são exatamente os definidos no design.
 */
export const CORRECTION_MAP: Readonly<Record<CorrectionKind, CorrectionStepSpec>> = Object.freeze({
  duplicate_phone: {
    step: "corrigir_celular_portal",
    field: "portal2_celular_alt",
    prompt: "Esse celular já consta no sistema. Me envia outro número de celular (com DDD) pra concluir.",
  },
  duplicate_email: {
    step: "corrigir_email_portal",
    field: "email",
    prompt: "Esse e-mail já está cadastrado. Me envia um e-mail diferente.",
  },
  duplicate_installation: {
    step: "corrigir_instalacao_portal",
    field: "numero_instalacao",
    prompt: "O número de instalação não foi aceito. Confere na conta e me envia de novo (7+ dígitos).",
  },
});

// ─── Normalização anti-repetição (Req 9.1) ───────────────────────────────────
/** Telefone/celular → somente dígitos (desconsidera espaços e símbolos). */
export function normalizePhone(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Número de instalação → somente dígitos. */
export function normalizeInstallation(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Email → trim + lowercase. */
export function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Normaliza um valor conforme a Classe_de_Erro (email = trim+lower; demais = dígitos). */
export function normalizeForKind(kind: string, value: string | null | undefined): string {
  return kind === "duplicate_email" ? normalizeEmail(value) : normalizePhone(value);
}

/**
 * Igualdade normalizada para anti-repetição (Req 9.1/9.2). Retorna `true` quando
 * o valor novo, após normalização, é igual ao valor anterior — caso em que o bot
 * deve rejeitar e re-perguntar sem re-despachar. Valores vazios nunca igualam
 * (não há "valor anterior" a comparar na primeira tentativa).
 */
export function isSameNormalized(
  kind: string,
  newValue: string | null | undefined,
  previousValue: string | null | undefined,
): boolean {
  const a = normalizeForKind(kind, newValue);
  const b = normalizeForKind(kind, previousValue);
  return a !== "" && a === b;
}

// ─── Validação de formato do dado corrigido (Req 7.2, 8.1) ───────────────────
/** Celular alternativo válido: ≥ 10 dígitos (Req 8.1). */
export function isValidCelular(value: string | null | undefined): boolean {
  return normalizePhone(value).length >= 10;
}

/**
 * Email de correção válido: contém `@` com ao menos 1 caractere antes e 1 depois
 * (Req 7.2). Validação intencionalmente mínima conforme o critério de aceitação.
 */
export function isValidCorrectionEmail(value: string | null | undefined): boolean {
  const t = String(value ?? "").trim();
  const at = t.indexOf("@");
  return at >= 1 && at < t.length - 1;
}

/** Número de instalação válido: ≥ 7 dígitos (Req 7.7). */
export function isValidInstallation(value: string | null | undefined): boolean {
  return normalizeInstallation(value).length >= 7;
}

// ─── Contador de tentativas por classe (Req 9.3/9.4) ─────────────────────────
type AttemptsMap = Record<string, unknown> | null | undefined;

/** Lê o contador de tentativas de uma classe, tolerando jsonb ausente/sujo (≥ 0). */
export function attemptsForKind(attempts: AttemptsMap, kind: string): number {
  if (!attempts || typeof attempts !== "object") return 0;
  const n = Number((attempts as Record<string, unknown>)[kind]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `true` quando a classe já atingiu/excedeu o limite de correção (Req 9.5/9.6). */
export function correctionLimitReached(attempts: AttemptsMap, kind: string): boolean {
  return attemptsForKind(attempts, kind) >= CORRECTION_LIMIT;
}

/** Retorna um novo mapa de tentativas com a classe incrementada em 1 (Req 9.4). */
export function incrementAttempts(attempts: AttemptsMap, kind: string): Record<string, number> {
  const base: Record<string, number> = {};
  if (attempts && typeof attempts === "object") {
    for (const [k, v] of Object.entries(attempts as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) base[k] = Math.floor(n);
    }
  }
  base[kind] = attemptsForKind(attempts, kind) + 1;
  return base;
}

// ─── Decisão de abertura da correção / guarda (Req 9.5, 10.1, 10.4) ──────────
export type CorrectionDecision =
  | { action: "open"; kind: CorrectionKind; spec: CorrectionStepSpec }
  | { action: "needs_human"; reason: "non_recoverable" | "limit_reached" }
  | { action: "none" };

/**
 * Decide o que o bot deve fazer dado o `portal2_error_kind` e o contador de
 * tentativas. É a guarda central do loop:
 *   - classe recuperável com tentativas < 3 → `open` (pede o dado novo);
 *   - classe recuperável com tentativas >= 3 → `needs_human` (limite, Req 9.5);
 *   - classe não-recuperável (duplicate_document/no_coverage/unknown) →
 *     `needs_human` (Req 10.1/10.4), nunca abre correção;
 *   - `missing_consumo` (auto-corrigido inline) ou vazio/desconhecido → `none`.
 */
export function decideCorrection(
  errorKind: string | null | undefined,
  attempts: AttemptsMap,
): CorrectionDecision {
  const kind = String(errorKind ?? "").trim();

  if (RECOVERABLE_CORRECTION_KINDS.has(kind)) {
    if (correctionLimitReached(attempts, kind)) {
      return { action: "needs_human", reason: "limit_reached" };
    }
    return { action: "open", kind: kind as CorrectionKind, spec: CORRECTION_MAP[kind as CorrectionKind] };
  }

  // missing_consumo é recuperável, mas tratado inline no portal_submitting.
  if (kind === "missing_consumo") return { action: "none" };

  // Classes explicitamente não-recuperáveis (Req 10.1/10.4).
  if (kind === "duplicate_document" || kind === "no_coverage" || kind === "unknown") {
    return { action: "needs_human", reason: "non_recoverable" };
  }

  // Vazio / não classificado → nada a corrigir (cadastro em andamento normal).
  return { action: "none" };
}

// ─── Mascaramento de PII para logs (Req 12.4) ────────────────────────────────
/** Mascara um valor numérico mantendo só os últimos `keep` dígitos. */
export function maskTail(value: string | null | undefined, keep = 4): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length <= keep) return "***";
  return `***${digits.slice(-keep)}`;
}

/** Mascara um email para log: mantém só a 1ª letra do local + domínio. */
export function maskEmailForLog(value: string | null | undefined): string {
  const t = String(value ?? "").trim();
  const at = t.indexOf("@");
  if (at < 1) return "***";
  return `${t.slice(0, 1)}***@${t.slice(at + 1)}`;
}

/** Mascara o valor corrigido conforme a classe, para uso seguro em logs (Req 12.4). */
export function maskCorrectionValueForLog(kind: string, value: string | null | undefined): string {
  return kind === "duplicate_email" ? maskEmailForLog(value) : maskTail(value, 4);
}
