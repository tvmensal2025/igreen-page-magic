/**
 * Ordem de envio compacta — chips horizontais (pula para a aba).
 */
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { CadenceTemplate } from "@/lib/multichannelCadenceTexts";
import type { CadenceEditorTab } from "@/components/admin/voz/CadenceFlowStyleEditor";

export type SendOrderStep = {
  id: string;
  tab: CadenceEditorTab;
  label: string;
  detail: string;
  done?: boolean;
};

export function buildSendOrderSteps(
  t: CadenceTemplate,
  opts?: {
    hasText?: boolean;
    hasAudio?: boolean;
    hasButtons?: boolean;
    textDone?: boolean;
    audioDone?: boolean;
    buttonsDone?: boolean;
  },
): SendOrderStep[] {
  const hasAudio = opts?.hasAudio ?? (t.canGenerateAudio || !!t.pairedAudioKey);
  const hasButtons =
    opts?.hasButtons ??
    ((t.buttons?.length ?? 0) > 0 || t.channel === "whatsapp_buttons");
  const hasText =
    opts?.hasText ??
    (t.channel === "whatsapp_text" ||
      t.channel === "whatsapp_buttons" ||
      t.channel === "sms" ||
      t.channel === "call_script" ||
      (t.canGenerateAudio && t.channel !== "whatsapp_audio"));

  const placement = t.audioPlacement ?? "before_text";
  const out: SendOrderStep[] = [];
  let n = 1;

  const push = (step: Omit<SendOrderStep, "label"> & { label: string }) => {
    out.push(step);
    n += 1;
  };

  if (t.channel === "whatsapp_audio" || t.channel === "call_script") {
    push({
      id: "audio",
      tab: "midias",
      label: `${n} Áudio`,
      detail: "Cortes → gerar MP3",
      done: opts?.audioDone,
    });
    return out;
  }

  // Erro OCR (5b/6b): texto obrigatório + áudio opcional
  if (t.linkedToStepKey) {
    push({
      id: "text",
      tab: "conteudo",
      label: `${n} Texto`,
      detail: "Mensagem quando a leitura falhar",
      done: opts?.textDone,
    });
    push({
      id: "audio",
      tab: "midias",
      label: `${n} Áudio`,
      detail: "Opcional · Sofia",
      done: opts?.audioDone,
    });
    return out;
  }

  if (hasAudio && placement === "before_text") {
    push({
      id: "audio",
      tab: "midias",
      label: `${n} Áudio`,
      detail: t.pairedAudioKey ? "Áudio pareado" : "Cortes → gerar",
      done: opts?.audioDone,
    });
  }

  if (hasText) {
    push({
      id: "text",
      tab: "conteudo",
      label: `${n} Texto`,
      detail: t.channel === "sms" ? "SMS" : "Mensagem WA",
      done: opts?.textDone,
    });
  }

  if (hasAudio && placement === "after_text") {
    push({
      id: "audio",
      tab: "midias",
      label: `${n} Áudio`,
      detail: "Cortes → gerar",
      done: opts?.audioDone,
    });
  }

  if (hasButtons) {
    push({
      id: "buttons",
      tab: "botoes",
      label: `${n} Botões`,
      detail: "Até 3 Whapi",
      done: opts?.buttonsDone,
    });
  }

  if (out.length === 0) {
    push({
      id: "text",
      tab: "conteudo",
      label: "1 Conteúdo",
      detail: "Revisar texto",
      done: opts?.textDone,
    });
  }

  return out;
}

type Props = {
  steps: SendOrderStep[];
  activeTab?: string;
  onGoTab: (tab: CadenceEditorTab) => void;
  className?: string;
};

export function CadenceSendOrderGuide({
  steps,
  activeTab,
  onGoTab,
  className,
}: Props) {
  if (steps.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        Ordem no WhatsApp
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {steps.map((s, idx) => {
          const active = activeTab === s.tab;
          return (
            <div key={s.id} className="flex items-center gap-1">
              {idx > 0 && (
                <span className="text-[10px] text-muted-foreground/40">→</span>
              )}
              <button
                type="button"
                title={s.detail}
                onClick={() => onGoTab(s.tab)}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
                    : s.done
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                      : "border-border/70 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {s.done && !active && <Check className="h-3 w-3" />}
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
