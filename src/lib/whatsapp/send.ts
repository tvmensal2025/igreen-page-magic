// Wrapper único para chamar a edge `manual-step-send` com toast amigável
// padronizado por código de erro. Centraliza a tradução PT-BR, timeout do
// client e o fluxo "name guard" (consultor é instruído a clicar em
// "Pedir nome" antes de avançar quando o lead ainda não tem nome capturado).
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SendStepPart = "text" | "audio" | "image" | "video" | "document" | "all";

export interface SendStepPayload {
  consultantId: string;
  customerId: string;
  stepId?: string;
  stepKey?: string;
  part: SendStepPart;
  mediaId?: string;
  continueFlow?: boolean;
  /** pula a checagem de nome — usar apenas no botão "Pedir nome" */
  skipNameGuard?: boolean;
  /** A/B/C escolhido pelo consultor nos chips (persiste no customer) */
  variant?: "A" | "B" | "C" | "D" | "E" | "M";
  /** ignora a trava awaiting_inbound (reenvio explícito) */
  force?: boolean;
}

export interface SendStepResult {
  ok: boolean;
  code?: string;
  message?: string;
  data?: any;
}

const CLIENT_TIMEOUT_MS = 55_000; // áudio Sofia (stitch) pode levar ~45s no 1º envio

const FRIENDLY: Record<string, string> = {
  unauthorized: "Sessão expirada — faça login novamente.",
  forbidden: "Sem permissão para enviar em nome deste consultor.",
  missing_fields: "Faltam dados obrigatórios.",
  missing_step: "Passo do fluxo não informado.",
  customer_not_found: "Lead não encontrado.",
  lead_sem_whatsapp: "Lead importado via Excel sem celular — não dá pra enviar pelo WhatsApp.",
  customer_no_phone: "Lead sem número de WhatsApp válido.",
  phone_invalid_format: "Número fora do padrão BR (DDI 55 + DDD + 8 ou 9 dígitos).",
  no_active_flow: "Nenhum fluxo ativo encontrado para esse consultor.",
  step_not_found: "Esse passo não existe mais — foi removido ou desativado.",
  name_not_captured_yet:
    "Antes de avançar, peça o nome do lead — clique em 'Pedir nome' no topo da ficha.",
  awaiting_inbound:
    "Aguarde o lead responder antes de enviar o próximo passo.",
  mismatch_pending:
    "Confirme a titularidade antes de finalizar — o nome da conta não bate com o do RG.",
  nothing_to_send: "Esse passo não tem mídia nem texto pra enviar.",
  whapi_token_missing: "Token do WhatsApp não configurado. Avise o admin.",
  phone_not_on_whatsapp: "Esse número não tem WhatsApp ativo.",
  instance_disconnected:
    "WhatsApp do consultor desconectado. Reconecte em /admin/conexao.",
  whapi_send_failed: "WhatsApp recusou o envio. Veja o detalhe e tente de novo.",
  whapi_network: "Sem resposta do WhatsApp (rede). Tente novamente em alguns segundos.",
  partial_send: "Parte dos itens não foi enviada. Tente reenviar só o que faltou.",
  internal_error: "Erro interno no servidor.",
  client_timeout: "Servidor demorou demais (áudio/personalização). Tente de novo.",
  empty_send_ok: "Edge respondeu OK mas não disparou nada. Veja se o passo tem mídia/texto.",
};

export function normalizeSendStepError(error: any, data?: any): { code: string; message: string } {
  const context = error?.context;
  const code = data?.code || data?.error || context?.code || context?.error || error?.code || "internal_error";
  const rawMessage = data?.message || context?.message || error?.message || "Falha ao chamar o servidor.";
  return { code, message: pickMessage(code, rawMessage) };
}

function pickMessage(code?: string, fallback?: string): string {
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  return fallback || "Não consegui enviar — tente de novo.";
}

async function parseErrorBody(error: any): Promise<{ code: string; message: string }> {
  let code = "internal_error";
  let message = error?.message || "Falha ao chamar o servidor.";
  const ctx: any = error?.context;
  if (!ctx) return { code, message };
  try {
    // ctx pode ser uma Response — clonamos pra não consumir o body.
    if (typeof ctx.clone === "function") {
      const cloned = ctx.clone();
      try {
        const body = await cloned.json();
        code = body?.code || body?.error || code;
        message = body?.message || message;
        return { code, message };
      } catch {
        try {
          const txt = await cloned.text();
          if (txt) message = txt.slice(0, 200);
        } catch { /* ignore */ }
      }
    } else if (typeof ctx.json === "function") {
      const body = await ctx.json();
      code = body?.code || body?.error || code;
      message = body?.message || message;
    }
  } catch { /* ignore */ }
  return { code, message };
}

export async function sendStepWithFeedback(
  payload: SendStepPayload,
  opts?: { silent?: boolean; onNameGuard?: () => void },
): Promise<SendStepResult> {
  // Timeout no client — evita botão girando pra sempre.
  const timeoutPromise = new Promise<SendStepResult>((resolve) => {
    setTimeout(() => {
      if (!opts?.silent) toast.error(FRIENDLY.client_timeout);
      resolve({ ok: false, code: "client_timeout", message: FRIENDLY.client_timeout });
    }, CLIENT_TIMEOUT_MS);
  });

  const invokePromise = (async (): Promise<SendStepResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("manual-step-send", {
        body: payload,
      });

      if (error) {
        const parsed = await parseErrorBody(error);
        const { code, message } = parsed.code === "internal_error"
          ? normalizeSendStepError(error)
          : { code: parsed.code, message: pickMessage(parsed.code, parsed.message) };
        if (code === "name_not_captured_yet" && opts?.onNameGuard) opts.onNameGuard();
        if (!opts?.silent) toast.error(message);
        return { ok: false, code, message };
      }

      if (data && data.ok === false) {
        const code = data.code || data.error || "unknown_error";
        const message = pickMessage(code, data.message);
        if (code === "name_not_captured_yet" && opts?.onNameGuard) opts.onNameGuard();
        if (!opts?.silent) toast.error(message);
        return { ok: false, code, message, data };
      }

      const sentCount = Array.isArray(data?.sent) ? data.sent.length : 0;
      const continued = data?.continued ? " (fluxo seguiu)" : "";

      // Edge respondeu OK mas não enviou nada — sinalizar como warning.
      if (sentCount === 0 && !data?.continued) {
        if (!opts?.silent) toast.warning(FRIENDLY.empty_send_ok);
        return { ok: false, code: "empty_send_ok", message: FRIENDLY.empty_send_ok, data };
      }

      if (!opts?.silent) {
        toast.success(
          sentCount > 0
            ? `${sentCount} item${sentCount > 1 ? "s" : ""} enviado${sentCount > 1 ? "s" : ""}${continued}`
            : `Enviado${continued}`,
        );
      }
      return { ok: true, data };
    } catch (e: any) {
      const message = e?.message || "Erro inesperado.";
      if (!opts?.silent) toast.error(message);
      return { ok: false, code: "client_error", message };
    }
  })();

  return Promise.race([invokePromise, timeoutPromise]);
}

/**
 * Dispara o passo "Pedir nome" — usa skipNameGuard=true e tenta achar um passo
 * configurado que pergunte o nome no fluxo ativo da variante do lead.
 * Se não encontrar, manda um texto direto.
 */
export async function askLeadName(opts: {
  consultantId: string;
  customerId: string;
  phoneHint?: string;
}): Promise<SendStepResult> {
  const { data: customer } = await supabase
    .from("customers")
    .select("flow_variant, name")
    .eq("id", opts.customerId)
    .maybeSingle();
  const variant = (customer as any)?.flow_variant || "A";

  const { data: flow } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("consultant_id", opts.consultantId)
    .eq("is_active", true)
    .eq("variant", variant)
    .maybeSingle();

  let stepKey: string | undefined;
  if (flow?.id) {
    const { data: steps } = await supabase
      .from("bot_flow_steps")
      .select("step_key, message_text, captures, position")
      .eq("flow_id", flow.id)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(20);
    const candidate = (steps || []).find((s: any) => {
      const caps = Array.isArray(s.captures) ? s.captures : [];
      if (caps.some((c: any) => String(c?.name || c?.field || "").toLowerCase() === "name")) return true;
      const t = String(s.message_text || "").toLowerCase();
      return /seu\s+nome|qual\s+(é\s+)?o?\s*seu\s+nome|como\s+(você\s+)?se\s+chama/.test(t);
    });
    if (candidate) stepKey = (candidate as any).step_key;
  }

  if (stepKey) {
    return sendStepWithFeedback({
      consultantId: opts.consultantId,
      customerId: opts.customerId,
      stepKey,
      part: "all",
      continueFlow: false,
      skipNameGuard: true,
    });
  }

  toast.error(
    "Não achei o passo de 'pedir nome' no fluxo ativo. Adicione um passo perguntando o nome no /admin/fluxos.",
  );
  return { ok: false, code: "no_name_step_in_flow", message: "Sem passo de nome no fluxo." };
}
