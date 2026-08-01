/**
 * Traduz erros técnicos (Auth Supabase, PostgREST, rede) para mensagem
 * amigável em português — nunca mostrar SQL/inglês cru no toast.
 */

const FALLBACK =
  "Não foi possível concluir. Tente novamente.";

const ALREADY_REGISTERED =
  "Este e-mail já tem conta. Faça login ou use Esqueci minha senha.";

const DUPLICATE_ACCOUNT =
  "Esta conta já está cadastrada. Faça login ou recupere a senha.";

type ErrLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};

function extractRaw(input: unknown): { message: string; code?: string } {
  if (input == null || input === "") return { message: "" };
  if (typeof input === "string") return { message: input };
  if (input instanceof Error) {
    const any = input as Error & { code?: string };
    return { message: any.message || "", code: any.code };
  }
  if (typeof input === "object") {
    const err = input as ErrLike;
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    return {
      message: parts.join(" — ") || String(input),
      code: err.code != null ? String(err.code) : undefined,
    };
  }
  return { message: String(input) };
}

/** Heurística: texto já parece português para o usuário. */
export function looksLikePortuguese(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(t)) return true;
  // Frases curtas comuns da UI já em PT
  if (
    /\b(não|nao|senha|e-mail|email|conta|tente|aguarde|sessão|sessao|permissão|permissao|conexão|conexao|cadastro|login|informe|preencha|falha|erro ao)\b/i.test(
      t,
    )
  ) {
    // Evita deixar passar inglês técnico misturado
    if (/violates unique|duplicate key|row-level|Password is known|Invalid login|Failed to fetch/i.test(t)) {
      return false;
    }
    return true;
  }
  return false;
}

function matchTranslation(message: string, code?: string): string | null {
  const msg = message.trim();
  const lower = msg.toLowerCase();
  const c = (code || "").toUpperCase();

  // --- PostgREST / Postgres ---
  if (
    c === "23505" ||
    /duplicate key|violates unique constraint/i.test(msg)
  ) {
    if (/consultants_pkey|consultants_license|consultants_/i.test(msg)) {
      return DUPLICATE_ACCOUNT;
    }
    if (/igreen_id/i.test(msg)) {
      return "Esse ID iGreen já está cadastrado em outra conta.";
    }
    return "Já existe um registro com esses dados.";
  }

  if (c === "23502" || /null value in column|violates not-null/i.test(msg)) {
    return "Faltou preencher um campo obrigatório. Revise e tente de novo.";
  }

  if (
    c === "42501" ||
    /row-level security|permission denied|not authorized|forbidden/i.test(lower)
  ) {
    return "Sessão expirou ou sem permissão. Faça login novamente.";
  }

  if (
    c === "PGRST301" ||
    /jwt expired|invalid jwt|session.*expired|refresh.?token/i.test(lower)
  ) {
    return "Sessão expirou. Faça login novamente.";
  }

  // --- Auth Supabase / GoTrue ---
  if (/password is known to be weak|easy to guess|weak password/i.test(msg)) {
    return "Essa senha é muito fraca. Escolha uma mais forte (letras, números e símbolos).";
  }

  if (/invalid login credentials|invalid email or password/i.test(lower)) {
    return "E-mail ou senha incorretos. Confira e tente de novo.";
  }

  if (/email not confirmed|email_not_confirmed/i.test(lower)) {
    return "Confirme seu e-mail antes de entrar. Olhe a caixa de entrada e o spam.";
  }

  if (
    /user already registered|already been registered|email.*already.*exists/i.test(
      lower,
    )
  ) {
    return ALREADY_REGISTERED;
  }

  if (/password should be at least|password.*at least \d+/i.test(lower)) {
    const m = msg.match(/at least (\d+)/i);
    const n = m?.[1] ?? "6";
    return `A senha deve ter pelo menos ${n} caracteres.`;
  }

  if (/same password|same_password/i.test(lower)) {
    return "A nova senha deve ser diferente da atual.";
  }

  if (
    /rate limit|too many requests|over_request_rate|email rate limit/i.test(lower)
  ) {
    return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  }

  if (/otp_expired|token.*expired|link.*expired|expired.*link/i.test(lower)) {
    return "Este link expirou. Peça um novo link de recuperação.";
  }

  if (/user not found|user_not_found/i.test(lower)) {
    return "Não encontramos uma conta com esses dados.";
  }

  // --- WhatsApp / Meta CTWA ---
  if (/application request limit|too many calls|rate.?limit|#80008|#4\b/i.test(lower)) {
    return "A Meta limitou as chamadas desta conta WhatsApp. Aguarde 10–30 minutos e tente de novo — sem isso o SMS não sai.";
  }

  if (/cannot add phone/i.test(lower)) {
    return "A Meta recusou incluir este número na conta WhatsApp da Página. Número já no app pessoal/Business, WABA com restrição, ou precisa migrar no WhatsApp Manager. SMS só sai depois que ela aceitar.";
  }

  // --- Identidade / áudios ---
  if (/gender_required/i.test(lower)) {
    return "Escolha Consultor ou Consultora e salve antes de gerar os áudios.";
  }
  if (/assistant_name_required/i.test(lower)) {
    return "Digite o nome da sua IA e salve antes de gerar os áudios.";
  }
  if (/name_required/i.test(lower)) {
    return "Digite seu nome completo e salve antes de gerar os áudios.";
  }
  if (/phone_required/i.test(lower)) {
    return "Telefone ainda era exigido na versão antiga. Atualize a página e tente Gerar minha identidade de novo.";
  }
  if (/media_incomplete/i.test(lower)) {
    return "Alguns áudios falharam na geração. Tente Gerar minha identidade de novo.";
  }
  if (/elevenlabs_api_key_missing/i.test(lower)) {
    return "A voz da IA está indisponível no momento. Avise o suporte.";
  }

  // --- Edge Functions (supabase.functions.invoke) ---
  if (/edge function returned a non-2xx|non-2xx status code/i.test(lower)) {
    return "Não deu certo agora. Confira os dados e tente de novo. Se continuar, fale com o suporte.";
  }

  if (/functionshttperror/i.test(lower)) {
    return "Não deu certo agora. Tente novamente em instantes.";
  }

  // --- Rede ---
  if (
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|aborted|etimedout|demorou demais/i.test(
      lower,
    )
  ) {
    return "Falha de conexão. Verifique a internet e tente novamente.";
  }

  // Título genérico
  if (msg === "Erro" || msg === "Error") {
    return "Algo deu errado";
  }

  if (/erro desconhecido|unknown error|something went wrong/i.test(lower)) {
    return FALLBACK;
  }

  return null;
}

/**
 * Converte qualquer erro/string de API em texto seguro para o usuário (pt-BR).
 */
export function toUserFacingError(
  input: unknown,
  fallback: string = FALLBACK,
): string {
  const { message, code } = extractRaw(input);
  if (!message.trim() && !code) return fallback;

  const translated = matchTranslation(message, code);
  if (translated) return translated;

  if (looksLikePortuguese(message)) return message.trim();

  // Inglês/técnico sem mapa: não vazar SQL/stack
  if (
    /violates |constraint |relation |column |null value|syntax error|stack|exception/i.test(
      message,
    ) ||
    /^[A-Z][a-z]+( [a-z]+){3,}/.test(message) // frase inglesa típica
  ) {
    if (typeof console !== "undefined") {
      console.warn("[userFacingError] mensagem técnica omitida:", message, code);
    }
    return fallback;
  }

  // Frase curta sem acento mas sem cheiro técnico — devolve truncada
  if (message.length <= 160 && !/[<>{}]/.test(message)) {
    // Se parece inglês (muitas palavras comuns), fallback
    if (
      /\b(the|and|please|choose|different|unable|failed|invalid|password|email)\b/i.test(
        message,
      )
    ) {
      if (typeof console !== "undefined") {
        console.warn("[userFacingError] inglês sem mapa:", message);
      }
      return fallback;
    }
    return message.trim();
  }

  if (typeof console !== "undefined") {
    console.warn("[userFacingError] fallback:", message, code);
  }
  return fallback;
}

/** Detecta “já existe / duplicate” para UX não-destrutiva no cadastro. */
export function isAlreadyExistsError(input: unknown): boolean {
  const { message, code } = extractRaw(input);
  if (code === "23505") return true;
  return /duplicate key|violates unique|already registered|already been registered|already exists/i.test(
    message,
  );
}

/**
 * Lê o JSON de erro de `supabase.functions.invoke` (FunctionsHttpError).
 * Em non-2xx o `error.message` costuma ser inglês genérico; o texto útil
 * está em `error.context` (Response) ou em `data`.
 */
export async function messageFromSupabaseFunctionInvoke(opts: {
  data?: unknown;
  error?: unknown;
  fallback?: string;
}): Promise<string> {
  const fallback = opts.fallback ?? FALLBACK;
  const data = opts.data as Record<string, unknown> | null | undefined;

  if (data && typeof data === "object") {
    const fromData =
      (typeof data.message === "string" && data.message.trim()) ||
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.detail === "string" && data.detail.trim()) ||
      (typeof data.hint === "string" && data.hint.trim()) ||
      "";
    if (fromData) return toUserFacingError(fromData, fallback);
  }

  const err = opts.error;
  if (!err) return fallback;

  try {
    const ctx = (err as { context?: Response })?.context;
    if (ctx && typeof ctx.clone === "function") {
      const text = await ctx.clone().text();
      if (text?.trim()) {
        try {
          const payload = JSON.parse(text) as Record<string, unknown>;
          const fromCtx =
            (typeof payload.message === "string" && payload.message.trim()) ||
            (typeof payload.error === "string" && payload.error.trim()) ||
            (typeof payload.detail === "string" && payload.detail.trim()) ||
            (typeof payload.hint === "string" && payload.hint.trim()) ||
            "";
          if (fromCtx) return toUserFacingError(fromCtx, fallback);
        } catch {
          /* body não-JSON */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return toUserFacingError(err, fallback);
}
