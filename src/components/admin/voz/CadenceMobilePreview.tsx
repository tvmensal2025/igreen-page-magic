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

function AudioBubble({
  audioUrl,
  hint,
}: {
  audioUrl?: string | null;
  hint: string;
}) {
  return (
    <div className="ml-auto w-[92%] max-w-[280px] overflow-hidden rounded-xl rounded-tr-sm bg-[#dcf8c6] shadow-sm">
      <div className="flex items-center gap-2.5 bg-[#d1efb5] px-3 py-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#075E54] text-white">
          <Volume2 className="h-4 w-4" />
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#075E54]/20">
          <div className="h-full w-2/5 rounded-full bg-[#075E54]" />
        </div>
        <span className="text-[11px] font-medium tabular-nums text-[#075E54]/85">áudio</span>
      </div>
      {audioUrl ? (
        <audio controls src={audioUrl} className="h-9 w-full px-1.5 pb-1.5" />
      ) : (
        <p className="px-3 pb-2.5 text-[11px] leading-snug text-[#075E54]/75">{hint}</p>
      )}
    </div>
  );
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
      <div className={cn("mx-auto w-full max-w-[320px]", className)}>
        <div className="overflow-hidden rounded-[1.75rem] border-[7px] border-zinc-900 bg-zinc-950 shadow-xl">
          <div className="bg-zinc-900 px-3 py-2 text-center">
            <p className="text-[11px] text-white/70">Mensagens</p>
            <p className="truncate text-[13px] font-semibold text-white">{contactName}</p>
          </div>
          <div className="min-h-[300px] bg-white px-3 py-4">
            <div className="max-w-[94%] rounded-2xl bg-[#e9e9eb] px-3.5 py-2.5 shadow-sm">
              <WhatsAppFormattedText
                text={text || "(vazio)"}
                className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-900"
              />
              <p className="mt-1 text-right text-[10px] text-zinc-500">{nowHm()}</p>
            </div>
            {text.length > 160 && (
              <p className="mt-3 text-[12px] text-amber-700">
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
      <div className={cn("mx-auto w-full max-w-[320px]", className)}>
        <div className="overflow-hidden rounded-[1.75rem] border-[7px] border-zinc-900 bg-gradient-to-b from-emerald-900 to-zinc-950 shadow-xl">
          <div className="px-4 pb-4 pt-8 text-center text-white">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white/15">
              <Phone className="h-6 w-6" />
            </div>
            <p className="text-base font-semibold">{contactName}</p>
            <p className="mt-1 text-[12px] text-white/70">Ligação · Sofia</p>
          </div>
          <div className="mx-3 mb-4 max-h-[240px] overflow-y-auto rounded-xl bg-black/35 px-3.5 py-3">
            <WhatsAppFormattedText
              text={text || "(sem script)"}
              className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/95"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("mx-auto w-full max-w-[320px]", className)}>
      <div className="overflow-hidden rounded-[1.75rem] border-[7px] border-zinc-900 bg-zinc-900 shadow-xl">
        {/* notch */}
        <div className="flex justify-center bg-zinc-900 pt-1.5">
          <div className="h-1.5 w-20 rounded-full bg-zinc-700/80" />
        </div>

        <div className="flex items-center gap-2.5 bg-[#075E54] px-3 py-2.5 text-white">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 text-[12px] font-bold">
            S
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight">{contactName}</p>
            <p className="text-[11px] text-white/75">online</p>
          </div>
        </div>

        <div
          className="min-h-[280px] max-h-[420px] space-y-2 overflow-y-auto px-2.5 py-3"
          style={{
            backgroundColor: "#ECE5DD",
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.04) 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.04) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          {!text.trim() && !showAudioChip && (
            <div className="grid h-44 place-items-center px-5 text-center text-[13px] leading-snug text-black/45">
              Digite o texto ao lado para ver a prévia com negrito e emoji
            </div>
          )}

          {!audioAfterText && showAudioChip && (
            <AudioBubble
              audioUrl={audioUrl}
              hint="Gere o áudio no painel para ouvir aqui"
            />
          )}

          {text.trim() && (
            <div
              className={cn(
                "w-[92%] max-w-[280px] rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 shadow-sm",
                isWa ? "ml-auto" : "mr-auto rounded-tr-xl rounded-tl-sm",
              )}
            >
              <WhatsAppFormattedText
                text={text}
                className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-[#111b21]"
              />
              <div className="mt-1 flex items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-[#667781]">{nowHm()}</span>
                <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />
              </div>
            </div>
          )}

          {audioAfterText && showAudioChip && (
            <AudioBubble
              audioUrl={audioUrl}
              hint="Texto → áudio → botões · gere o áudio neste passo"
            />
          )}

          {buttons.length > 0 && (
            <div className="ml-auto w-[92%] max-w-[280px] space-y-1.5 pt-0.5">
              {buttons.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  className="rounded-lg border border-black/5 bg-white px-3 py-2.5 text-center text-[13px] font-medium text-[#027eb5] shadow-sm"
                >
                  {b.title}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-[#F0F0F0] px-2.5 py-2.5">
          <div className="flex-1 rounded-full bg-white px-3.5 py-2 text-[12px] text-black/35">
            Mensagem
          </div>
          <Mic className="h-5 w-5 text-[#075E54]" />
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
        className="h-7 rounded-md border border-border/70 px-2 text-[11px] font-semibold hover:bg-secondary/60"
        title="Envolver seleção com *negrito*"
        onClick={() => onInsert("", { before: "*", after: "*" })}
      >
        B
      </button>
      <button
        type="button"
        className="h-7 rounded-md border border-border/70 px-2 text-[11px] italic hover:bg-secondary/60"
        title="Itálico _texto_"
        onClick={() => onInsert("", { before: "_", after: "_" })}
      >
        I
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          className="h-7 w-7 rounded-md text-sm leading-none hover:bg-secondary/60"
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
