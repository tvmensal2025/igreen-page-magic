/**
 * Canal de novidades — resposta inbound p/ cliente carteira
 * (`igreen_sync` / `igreen_extension`).
 *
 * NÃO entra no Grupo A, NÃO dispara OCR/Portal, NÃO muda conversation_step.
 * Fluxo opcional (`cliente_canal_flow_id`) fica só reservado — ainda não executa.
 */

import { safeFirstNameForAddress } from "./customer-display-name.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

/** Cooldown entre respostas automáticas do canal (anti-spam se o cliente mandar várias). */
export const CLIENTE_CANAL_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export const DEFAULT_CLIENTE_CANAL_REPLY = `🌿 *Oi{{saudacao}}!*

Que bom te ver por aqui 💚

Este número é o nosso *canal de novidades e recados* — um cantinho só pra gente continuar juntos.

✨ Por aqui você recebe:
• Novidades e avisos importantes
• Dicas e lembretes úteis
• Recadinhos do time

📌 *Não é um atendimento de cadastro.* Se precisar de algo urgente com sua conta, fale com o seu consultor pelo canal habitual.

Obrigado por caminhar com a gente — *estamos juntos!* 🤝☀️`;

export type ClienteCanalPrefs = {
  enabled: boolean;
  text: string | null;
  flowId: string | null;
};

export function buildClienteCanalReply(opts: {
  text?: string | null;
  name?: string | null;
  nameSource?: string | null;
}): string {
  const raw = (opts.text && opts.text.trim()) || DEFAULT_CLIENTE_CANAL_REPLY;
  const first = safeFirstNameForAddress(opts.name, opts.nameSource);
  const saudacao = first ? `, ${first}` : "";
  return raw.replace(/\{\{saudacao\}\}/g, saudacao).replace(/\{\{nome\}\}/g, first || "");
}

export async function loadClienteCanalPrefs(
  supabase: SB,
  consultantId: string | null | undefined,
): Promise<ClienteCanalPrefs> {
  if (!consultantId) {
    return { enabled: true, text: null, flowId: null };
  }
  const { data, error } = await supabase
    .from("consultant_automation_prefs")
    .select("cliente_canal_reply_enabled, cliente_canal_reply_text, cliente_canal_flow_id")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (error) {
    console.warn("[cliente-canal] prefs:", error.message);
    return { enabled: true, text: null, flowId: null };
  }
  return {
    enabled: data?.cliente_canal_reply_enabled !== false,
    text: data?.cliente_canal_reply_text ?? null,
    flowId: data?.cliente_canal_flow_id ?? null,
  };
}

/**
 * Responde cliente carteira com a msg de novidades.
 * @returns `handled` — true = turno consumido (não rodar Grupo A / cadastro).
 */
export async function tryReplyClienteCanalNovidades(opts: {
  supabase: SB;
  customer: {
    id: string;
    name?: string | null;
    name_source?: string | null;
    consultant_id?: string | null;
    cliente_canal_last_reply_at?: string | null;
  };
  consultantId: string;
  sendText: (text: string) => Promise<boolean>;
  now?: Date;
}): Promise<{ handled: boolean; sent: boolean; reason: string }> {
  const prefs = await loadClienteCanalPrefs(opts.supabase, opts.consultantId);
  if (!prefs.enabled) {
    return { handled: false, sent: false, reason: "disabled" };
  }

  const now = opts.now ?? new Date();
  const last = opts.customer.cliente_canal_last_reply_at
    ? new Date(opts.customer.cliente_canal_last_reply_at).getTime()
    : 0;
  if (last && now.getTime() - last < CLIENTE_CANAL_COOLDOWN_MS) {
    console.log(
      `[cliente-canal] cooldown customer=${opts.customer.id} flow_reserved=${prefs.flowId || "none"}`,
    );
    return { handled: true, sent: false, reason: "cooldown" };
  }

  const body = buildClienteCanalReply({
    text: prefs.text,
    name: opts.customer.name,
    nameSource: opts.customer.name_source,
  });

  let ok = false;
  try {
    ok = await opts.sendText(body);
  } catch (e) {
    console.warn("[cliente-canal] send failed:", (e as Error)?.message);
    return { handled: true, sent: false, reason: "send_error" };
  }

  if (ok) {
    await opts.supabase
      .from("customers")
      .update({ cliente_canal_last_reply_at: now.toISOString() })
      .eq("id", opts.customer.id);
  }

  console.log(
    `[cliente-canal] customer=${opts.customer.id} sent=${ok} flow_reserved=${prefs.flowId || "none"}`,
  );
  return { handled: true, sent: ok, reason: ok ? "sent" : "send_failed" };
}
