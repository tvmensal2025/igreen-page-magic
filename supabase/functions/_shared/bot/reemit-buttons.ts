/**
 * reemit-buttons.ts — Helper reutilizável para reapresentar botões do step
 * atual após responder uma FAQ/dúvida, garantindo que o lead tenha um CTA
 * clicável de volta ao fluxo.
 *
 * Usado por: evolution-webhook, whapi-webhook, engine v3 dispatcher.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SendButtonsFn = (
  remoteJid: string,
  text: string,
  buttons: Array<{ id: string; title: string }>,
) => Promise<boolean | void>;

export type SendTextFn = (
  remoteJid: string,
  text: string,
) => Promise<boolean | void>;

export interface ReemitOpts {
  supabase: SupabaseClient;
  customerId: string;
  consultantId: string;
  flowVariant?: string;
  stepKey: string;
  remoteJid: string;
  sendButtons: SendButtonsFn;
  /** Opcional: usado para enviar texto numerado quando há >3 opções. */
  sendText?: SendTextFn;
  /** Se true, não reemite (ex: handoff acionado) */
  skipIfHandoff?: boolean;
  /** Número de follow-ups no step. Não reemite se >= 2 (anti-loop) */
  followups?: number;
  /** Se fornecido, usa captures desse stepRow ao invés de consultar o banco */
  stepCaptures?: any[];
  /** Delay antes do envio (ms). Default 600. Use 0 em testes. */
  delayMs?: number;
}

/**
 * Reemite os botões do passo atual após uma resposta de FAQ/IA.
 * Retorna `true` se enviou botões, `false` se pulou (sem botões, handoff, etc).
 */
export async function reemitStepButtons(opts: ReemitOpts): Promise<boolean> {
  const {
    supabase,
    customerId,
    consultantId,
    flowVariant = "A",
    stepKey,
    remoteJid,
    sendButtons,
    sendText,
    skipIfHandoff = false,
    followups = 0,
    stepCaptures,
    delayMs = 600,
  } = opts;

  if (skipIfHandoff) return false;
  if (followups >= 2) return false;
  if (!stepKey) return false;

  try {
    let captures: any[] = [];

    if (stepCaptures && Array.isArray(stepCaptures)) {
      captures = stepCaptures;
    } else {
      // Resolve flow e busca step
      const { data: flowRow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("variant", flowVariant)
        .eq("is_active", true)
        .maybeSingle();

      if (!flowRow?.id) return false;

      // conversation_step costuma ser UUID; aceita id ou step_key.
      const { data: stepRow } = await supabase
        .from("bot_flow_steps")
        .select("captures, step_key")
        .eq("flow_id", flowRow.id)
        .or(`step_key.eq.${stepKey},id.eq.${stepKey}`)
        .maybeSingle();

      captures = Array.isArray((stepRow as any)?.captures) ? (stepRow as any).captures : [];
    }

    // Extrai _buttons das captures
    const btnCap = captures.find(
      (c: any) => c?.field === "_buttons" && c?.enabled !== false,
    );
    const rawButtons = Array.isArray(btnCap?.value) ? btnCap.value : [];
    const renderedButtons = rawButtons
      .map((b: any) => ({
        id: String(b?.id || "").trim(),
        title: String(b?.title || "").trim().slice(0, 20),
      }))
      .filter((b: any) => b.id && b.title);

    if (renderedButtons.length === 0) return false;

    // Delay curto para separar mensagens (600ms)
    await new Promise((r) => setTimeout(r, delayMs));

    const promptText = "👇 *Escolha uma opção:*";
    // WhatsApp limita botões interativos a 3. Se houver mais e tivermos um
    // sendText, mandamos TODAS as opções como texto numerado (senão o Whapi
    // truncaria silenciosamente a 4ª+ opção). Sem sendText, caímos no
    // sendButtons (Evolution numera tudo; Whapi trunca — comportamento atual).
    let sent: boolean | void;
    if (renderedButtons.length > 3 && typeof sendText === "function") {
      const numbered = `${promptText}\n\n${
        renderedButtons.map((b: { id: string; title: string }, i: number) => `*${i + 1}.* ${b.title}`).join("\n")
      }\n\n_Digite o número da opção desejada._`;
      sent = await sendText(remoteJid, numbered);
    } else {
      sent = await sendButtons(remoteJid, promptText, renderedButtons);
    }

    // Só registra no histórico se o envio não falhou explicitamente.
    if (sent === false) {
      console.warn("[reemitStepButtons] sendButtons retornou false — não loga");
      return false;
    }

    await supabase.from("conversations").insert({
      customer_id: customerId,
      message_direction: "outbound",
      message_text: promptText,
      message_type: "buttons",
      conversation_step: stepKey,
    });

    return true;
  } catch (e) {
    console.warn("[reemitStepButtons] falhou:", (e as Error).message);
    return false;
  }
}
