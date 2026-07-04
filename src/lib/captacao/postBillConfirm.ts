// Helper compartilhado para a lógica pós "Eu confirmo" do OCR.
// Usado por OcrReviewCard e CaptureDataConfirmCard — antes era duplicado.
//
// Fluxo:
// 1. Acha o bot_flow ativo do consultor (filtrado por variant A/B/C).
// 2. Pega passos `message` que ficam ENTRE o capture atual e o próximo capture/
//    finalizar — despacha cada um via `manual-step-send` com gap humano.
// 3. Se o fluxo não tem nenhum passo de simulação (variantes simples), injeta
//    fallback hardcoded com a copy oficial "até 20%" (mem://copy/discount-rate-20).
// 4. Despacha o próximo capture step.

import { supabase } from "@/integrations/supabase/client";
import { discountRates } from "./discount-rates";


export interface PostBillConfirmArgs {
  customer: any;
  kind: "bill" | "doc";
  /** Se true, o próximo capture step encadeia o resto do fluxo. Default true. */
  continueFlowOnNextCapture?: boolean;
}

export interface PostBillConfirmResult {
  dispatchedBetween: number;
  nextCaptureKey: string;
  fallbackSimulationSent: boolean;
}

const STOP_CAPTURE_TYPES = new Set([
  "capture_documento",
  "capture_doc",
  "capture_email",
  "confirm_phone",
  "finalizar_cadastro",
]);

const INTER_MESSAGE_DELAY_MS = 1800;
const POST_FALLBACK_DELAY_MS = 1500;

/** Copy oficial de simulação. Fluxo M (MG) usa 10-28%; demais 8-20%. */
function buildSimulationText(customer: any, valor: number): string {
  const rates = discountRates(customer?.flow_variant);
  const economia = Math.max(1, Math.round(valor * rates.max));
  const fmtBRL = (n: number) =>
    n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const firstName = String(customer?.name || "").trim().split(/\s+/)[0] || "";
  return (
    `🎉 *Pronto${firstName ? `, ${firstName}` : ""}!* Já fiz a *simulação* com base na sua conta.\n\n` +
    `💡 Conta atual: *R$ ${fmtBRL(valor)}*\n` +
    `💚 Economia: *até R$ ${fmtBRL(economia)} todo mês* (${rates.label})\n\n` +
    `✅ Sem obra\n✅ Sem instalação\n✅ Mesma distribuidora — só muda quem fornece a energia\n\n` +
    `Bora *finalizar seu cadastro agora*? 🚀`
  );
}

async function sendFallbackSimulation(customer: any): Promise<boolean> {
  const valor = Number(customer?.electricity_bill_value || 0);
  if (!(valor > 30)) return false;

  let phone = String(customer?.phone_whatsapp || "").replace(/\D/g, "");
  if (!phone) return false;
  if (!phone.startsWith("55")) phone = "55" + phone;
  const to = `${phone}@s.whatsapp.net`;

  const text = buildSimulationText(customer, valor);
  try {
    await supabase.functions.invoke("whapi-proxy", {
      body: { action: "send_text", consultantId: customer.consultant_id, payload: { to, text } },
    });
    await supabase.from("conversations").insert({
      customer_id: customer.id,
      message_direction: "outbound",
      message_text: text,
      message_type: "text",
      conversation_step: "simulacao_consultor",
    });
    await new Promise((r) => setTimeout(r, POST_FALLBACK_DELAY_MS));
    return true;
  } catch (err: any) {
    console.warn("[post-bill-confirm] fallback simulação falhou:", err?.message);
    return false;
  }
}

export async function dispatchPostBillConfirm(
  args: PostBillConfirmArgs,
): Promise<PostBillConfirmResult> {
  const { customer, kind, continueFlowOnNextCapture = true } = args;
  const nextCaptureKey = kind === "bill" ? "capture_documento" : "finalizar_cadastro";
  const currentCaptureType = kind === "bill" ? "capture_conta" : "capture_documento";

  let dispatchedBetween = 0;
  let fallbackSimulationSent = false;

  try {
    const variant = (customer as any)?.flow_variant || "A";
    const { data: flowRow } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", customer.consultant_id)
      .eq("is_active", true)
      .eq("variant", variant)
      .maybeSingle();

    if (flowRow?.id) {
      const { data: allSteps } = await supabase
        .from("bot_flow_steps")
        .select("position, step_key, step_type, is_active")
        .eq("flow_id", flowRow.id)
        .eq("is_active", true)
        .order("position", { ascending: true });

      const steps = (allSteps as any[]) || [];
      const captureIdx = steps.findIndex((s) => s.step_type === currentCaptureType);
      const nextStopIdx = steps.findIndex(
        (s, i) => i > captureIdx && STOP_CAPTURE_TYPES.has(s.step_type),
      );
      const between =
        captureIdx >= 0
          ? steps
              .slice(captureIdx + 1, nextStopIdx > 0 ? nextStopIdx : steps.length)
              .filter((s) => s.step_type === "message")
          : [];

      for (const msgStep of between) {
        try {
          await supabase.functions.invoke("manual-step-send", {
            body: {
              consultantId: customer.consultant_id,
              customerId: customer.id,
              stepKey: msgStep.step_key,
              part: "all",
              continueFlow: false,
              skipNameGuard: true,
            },
          });
          dispatchedBetween++;
          await new Promise((r) => setTimeout(r, INTER_MESSAGE_DELAY_MS));
        } catch (msgErr: any) {
          console.warn(
            `[post-bill-confirm] msg-step ${msgStep.step_key} failed:`,
            msgErr?.message,
          );
        }
      }
    }

    // Fallback: fluxo sem simulação → injeta proposta padrão (até 20%).
    if (kind === "bill" && dispatchedBetween === 0) {
      fallbackSimulationSent = await sendFallbackSimulation(customer);
    }

    // Avança para o próximo capture.
    await supabase.functions.invoke("manual-step-send", {
      body: {
        consultantId: customer.consultant_id,
        customerId: customer.id,
        stepKey: nextCaptureKey,
        part: "all",
        continueFlow: continueFlowOnNextCapture,
        skipNameGuard: true,
      },
    });
  } catch (advErr: any) {
    console.warn("[post-bill-confirm] advance flow failed:", advErr?.message);
  }

  return { dispatchedBetween, nextCaptureKey, fallbackSimulationSent };
}
