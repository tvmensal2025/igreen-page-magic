/**
 * Espelha textos/botões do painel Multicanal em bot_flow_steps.
 * O WhatsApp lê message_text + captures._buttons do fluxo — não o localStorage.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  resolveBody,
  resolveButtons,
  type SavedCadenceLibrary,
} from "@/lib/multichannelCadenceTexts";

type CaptureRow = {
  field?: string;
  enabled?: boolean;
  value?: unknown;
  [k: string]: unknown;
};

type TransitionRow = {
  trigger_intent?: string | null;
  trigger_phrases?: string[] | null;
  goto_step_id?: string | null;
  goto_special?: string | null;
  [k: string]: unknown;
};

export async function syncCadenceLibraryToBotFlow(
  consultantId: string,
  lib: SavedCadenceLibrary,
  variant: string = "A",
): Promise<{ updated: string[]; skipped: string[]; errors: string[] }> {
  const updated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const { data: flow, error: flowErr } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("variant", variant)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (flowErr || !flow?.id) {
    errors.push(flowErr?.message || `fluxo ${variant} ativo não encontrado`);
    return { updated, skipped, errors };
  }

  const syncable = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) =>
      t.group === "A" &&
      !t.hiddenInPanel &&
      (t.channel === "whatsapp_text" ||
        t.channel === "whatsapp_buttons" ||
        t.channel === "whatsapp_audio" ||
        !!t.buttons?.length),
  );

  for (const tpl of syncable) {
    // Áudio puro sem texto WhatsApp próprio: não sobrescreve message_text do passo misto.
    if (tpl.channel === "whatsapp_audio" && !tpl.buttons?.length) {
      skipped.push(tpl.key);
      continue;
    }

    const { data: step, error: stepErr } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, message_text, captures, transitions")
      .eq("flow_id", flow.id)
      .eq("step_key", tpl.key)
      .maybeSingle();

    if (stepErr) {
      errors.push(`${tpl.key}: ${stepErr.message}`);
      continue;
    }
    if (!step?.id) {
      skipped.push(tpl.key);
      continue;
    }

    const body = resolveBody(tpl, lib).trim();
    const buttons = resolveButtons(tpl, lib);
    const captures = Array.isArray(step.captures)
      ? ([...step.captures] as CaptureRow[])
      : [];
    const withoutButtons = captures.filter((c) => c.field !== "_buttons");
    const nextCaptures =
      buttons.length > 0
        ? [
            ...withoutButtons,
            {
              field: "_buttons",
              enabled: true,
              value: buttons.map((b) => ({ id: b.id, title: b.title })),
            },
          ]
        : withoutButtons;

    // Mantém goto dos transitions; só reforça frases com id + título atuais.
    let nextTransitions = step.transitions as TransitionRow[] | null;
    if (buttons.length > 0 && Array.isArray(step.transitions)) {
      nextTransitions = (step.transitions as TransitionRow[]).map((tr) => {
        const phrases = Array.isArray(tr.trigger_phrases) ? tr.trigger_phrases : [];
        const matchedBtn = buttons.find(
          (b) =>
            phrases.some(
              (p) =>
                String(p).toLowerCase() === b.id.toLowerCase() ||
                String(p).toLowerCase() === b.title.toLowerCase(),
            ),
        );
        if (!matchedBtn) return tr;
        const nextPhrases = Array.from(
          new Set([matchedBtn.id, matchedBtn.title, ...phrases.filter(Boolean)]),
        );
        return { ...tr, trigger_phrases: nextPhrases };
      });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body && tpl.channel !== "whatsapp_audio") {
      patch.message_text = body;
    }
    if (buttons.length > 0 || captures.some((c) => c.field === "_buttons")) {
      patch.captures = nextCaptures;
    }
    if (nextTransitions) patch.transitions = nextTransitions;

    const { error: upErr } = await supabase
      .from("bot_flow_steps")
      .update(patch)
      .eq("id", step.id);

    if (upErr) {
      errors.push(`${tpl.key}: ${upErr.message}`);
      continue;
    }
    updated.push(tpl.key);
  }

  return { updated, skipped, errors };
}
