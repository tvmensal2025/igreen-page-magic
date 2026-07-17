/**
 * Prévia mobile WhatsApp — negrito (*texto*), itálico, emoji colorido e botões.
 */
import { CheckCheck, Mic, Phone, Volume2 } from "lucide-react";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import type { CadenceButton, CadenceChannel } from "@/lib/multichannelCadenceTexts";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  buttons?: CadenceButton[];
  channel: CadenceChannel;
  contactName?: string;
  audioUrl?: string | null;
  /** Força chip de áudio na prévia (ordem WhatsApp). */
  showAudio?: boolean;
  /** Texto → áudio → botões (`after_text`) ou áudio → texto → botões. */
  audioPlacement?: "before_text" | "after_text";
  className?: string;
};

function nowHm() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function CadenceMobilePreview({
  text,
  buttons = [],
  channel,
  contactName = "Sofia · iGreen",
  audioUrl,
  showAudio,
  audioPlacement = "before_text",
  className,
}: Props) {
  const isSms = channel === "sms";
  const isCall = channel === "call_script";
  const isAudio = channel === "whatsapp_audio";
  const isWa =
    channel === "whatsapp_text" ||
    channel === "whatsapp_buttons" ||
    channel === "whatsapp_audio";
  const showAudioChip = showAudio || isAudio || !!audioUrl;
  const audioAfterText = audioPlacement === "after_text";

  if (isSms) {
    return (
      <div className={cn("w-full max-w-[280px] mx-auto", className)}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 text-center">
          Prévia SMS
        </p>
        <div className="rounded-[1.75rem] border-[7px] border-zinc-900 bg-zinc-950 shadow-xl overflow-hidden">
          <div className="bg-zinc-900 px-3 py-2 text-center">
            <p className="text-[11px] text-white/80">Mensagens</p>
            <p className="text-xs font-semibold text-white truncate">{contactName}</p>
          </div>
          <div className="min-h-[340px] bg-white px-3 py-4">
            <div className="max-w-[92%] rounded-2xl bg-[#e9e9eb] px-3 py-2 shadow-sm">
              <WhatsAppFormattedText
                text={text || "(vazio)"}
                className="text-[13px] leading-snug text-zinc-900 whitespace-pre-wrap break-words"
              />
              <p className="text-[9px] text-zinc-500 text-right mt-1">{nowHm()}</p>
            </div>
            {text.length > 160 && (
              <p className="mt-2 text-[10px] text-amber-700">
                {text.length} caracteres — SMS pode dividir em partes.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isCall) {
    return (
      <div className={cn("w-full max-w-[280px] mx-auto", className)}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 text-center">
          Script ligação
        </p>
        <div className="rounded-[1.75rem] border-[7px] border-zinc-900 bg-gradient-to-b from-emerald-900 to-zinc-950 shadow-xl overflow-hidden">
          <div className="px-4 pt-8 pb-4 text-center text-white">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/15">
              <Phone className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold">{contactName}</p>
            <p className="text-xs text-white/70 mt-0.5">Ligação · voz Sofia</p>
          </div>
          <div className="mx-3 mb-4 rounded-xl bg-black/30 px-3 py-3 max-h-[280px] overflow-y-auto">
            <WhatsAppFormattedText
              text={text || "(sem script)"}
              className="text-[12px] leading-relaxed text-white/95 whitespace-pre-wrap break-words"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full max-w-[280px] mx-auto", className)}>
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Prévia WhatsApp
        </p>
        <span className="text-[9px] text-emerald-700/80 font-medium">ao vivo</span>
      </div>

      <div className="rounded-[1.85rem] border-[8px] border-zinc-900 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 bg-[#075E54] px-3 py-2.5 text-white">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-xs font-bold">
            S
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold truncate leading-tight">{contactName}</p>
            <p className="text-[10px] text-white/70">online</p>
          </div>
        </div>

        <div
          className="min-h-[360px] max-h-[480px] overflow-y-auto px-2.5 py-3 space-y-2"
          style={{
            backgroundColor: "#ECE5DD",
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.035) 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.035) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        >
          {!text.trim() && !showAudioChip && (
            <div className="grid h-40 place-items-center text-center text-[11px] text-black/45 px-4">
              Digite o texto ao lado para ver a prévia com negrito e emoji
            </div>
          )}

          {/* Ordem: before_text = áudio→texto→botões | after_text = texto→áudio→botões */}
          {!audioAfterText && showAudioChip && (
            <div className="ml-auto max-w-[92%] rounded-lg bg-[#dcf8c6] shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#d1efb5]">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-[#075E54] text-white">
                  <Volume2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-[#075E54]/25 overflow-hidden">
                  <div className="h-full w-2/5 rounded-full bg-[#075E54]" />
                </div>
                <span className="text-[10px] text-[#075E54]/80 tabular-nums">áudio</span>
              </div>
              {audioUrl ? (
                <audio controls src={audioUrl} className="w-full h-8 px-1 pb-1" />
              ) : (
                <p className="px-3 pb-2 text-[10px] text-[#075E54]/70">
                  Gere o áudio no painel para ouvir aqui
                </p>
              )}
            </div>
          )}

          {text.trim() && (
            <div
              className={cn(
                "max-w-[92%] rounded-lg bg-[#dcf8c6] px-2.5 py-1.5 shadow-sm",
                isWa ? "ml-auto" : "mr-auto",
              )}
            >
              <WhatsAppFormattedText
                text={text}
                className="text-[13px] leading-[1.35] text-[#111b21] whitespace-pre-wrap break-words"
              />
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <span className="text-[9px] text-[#667781] tabular-nums">{nowHm()}</span>
                <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
              </div>
            </div>
          )}

          {audioAfterText && showAudioChip && (
            <div className="ml-auto max-w-[92%] rounded-lg bg-[#dcf8c6] shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#d1efb5]">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-[#075E54] text-white">
                  <Volume2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-[#075E54]/25 overflow-hidden">
                  <div className="h-full w-2/5 rounded-full bg-[#075E54]" />
                </div>
                <span className="text-[10px] text-[#075E54]/80 tabular-nums">áudio</span>
              </div>
              {audioUrl ? (
                <audio controls src={audioUrl} className="w-full h-8 px-1 pb-1" />
              ) : (
                <p className="px-3 pb-2 text-[10px] text-[#075E54]/70">
                  Texto → áudio → botões · gere o áudio neste passo
                </p>
              )}
            </div>
          )}

          {buttons.length > 0 && (
            <div className="ml-auto max-w-[92%] space-y-1 pt-0.5">
              {buttons.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  className="rounded-md bg-white px-3 py-2 text-center text-[12px] font-medium text-[#027eb5] shadow-sm border border-black/5"
                >
                  {b.title}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-[#F0F0F0] px-2.5 py-2">
          <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-[11px] text-black/35">
            Mensagem
          </div>
          <Mic className="h-4 w-4 text-[#075E54]" />
        </div>
      </div>
    </div>
  );
}

const QUICK_EMOJIS = ["😊", "👍", "⚡", "💡", "🌱", "✅", "👋", "💚"];

/** Barra rápida: negrito WhatsApp + emojis comuns. */
export function CadenceFormatToolbar({
  onInsert,
}: {
  onInsert: (snippet: string, wrapSelection?: { before: string; after: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="h-7 px-2 rounded-md border border-border/70 text-[11px] font-semibold hover:bg-secondary/60"
        title="Envolver seleção com *negrito*"
        onClick={() => onInsert("", { before: "*", after: "*" })}
      >
        B
      </button>
      <button
        type="button"
        className="h-7 px-2 rounded-md border border-border/70 text-[11px] italic hover:bg-secondary/60"
        title="Itálico _texto_"
        onClick={() => onInsert("", { before: "_", after: "_" })}
      >
        I
      </button>
      <span className="w-px h-4 bg-border mx-0.5" />
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          className="h-7 w-7 rounded-md hover:bg-secondary/60 text-sm leading-none"
          style={{
            fontFamily:
              '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif',
          }}
          onClick={() => onInsert(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
