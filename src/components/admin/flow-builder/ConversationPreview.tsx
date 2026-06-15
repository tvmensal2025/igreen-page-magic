// ConversationPreview — celular que SIMULA a conversa inteira do fluxo.
//
// Diferente do WhatsAppPreview (que mostra UM passo isolado), este componente
// recebe a LISTA de passos e desenha o vai-e-vem completo: o bot fala, e o
// cliente fictício (PREVIEW_PERSONA — "João Silva") responde com dados de
// mentira COERENTES com o tipo de cada passo (nome, telefone, foto da conta…).
// É 100% visual: nada vai ao banco. Serve de "espelho" ao vivo no estúdio da
// Iris — o consultor digita à esquerda e vê a conversa montando aqui.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Step,
  renderVarsPreview,
  getButtons,
  simulatedClientReply,
  botConfirmationAfter,
} from "./flowTypes";
import { CheckCheck, Mic, Image as ImageIcon, Video, Rocket, FileText, ScanLine } from "lucide-react";

interface Props {
  steps: Step[];
  consultantName?: string;
  /** Id do passo em foco — sua bolha ganha um anel destacado. */
  focusStepId?: string | null;
}

export default function ConversationPreview({ steps, consultantName, focusStepId }: Props) {
  const ordered = useMemo(
    () => [...steps].filter((s) => s.is_active !== false).sort((a, b) => a.position - b.position),
    [steps],
  );

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[2rem] border-8 border-zinc-900 bg-zinc-900 shadow-2xl">
      {/* Header WhatsApp */}
      <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-semibold">
          {(consultantName?.[0] || "B").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{consultantName || "Bot iGreen"}</div>
          <div className="text-[11px] text-white/70">online agora</div>
        </div>
      </div>

      {/* Conversa */}
      <div
        className="max-h-[520px] min-h-[460px] space-y-2 overflow-y-auto bg-[#ECE5DD] p-3"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.3) 0%, transparent 50%)",
        }}
      >
        {ordered.length === 0 && (
          <div className="grid h-[440px] place-items-center px-4 text-center text-xs text-black/60">
            Comece adicionando um passo.<br />A conversa do cliente vai aparecer aqui.
          </div>
        )}

        {ordered.map((step) => {
          const text = renderVarsPreview(step.message_text, consultantName);
          const buttons = getButtons(step);
          const reply = simulatedClientReply(step);
          const confirm = botConfirmationAfter(step);
          const focused = step.id === focusStepId;
          const isFinal = (step.step_type ?? "") === "finalizar_cadastro";
          const stype = (step.step_type ?? "").toLowerCase();
          const isOcrConta = stype === "capture_conta";
          const isOcrDoc = stype === "capture_documento" || stype === "capture_doc";

          return (
            <div key={step.id} className="space-y-2">
              {/* Mídia anexada — mostra só os tipos escolhidos (media_order),
                  na ordem definida. Sem media_order, cai no comportamento antigo
                  (mostra os 3) apenas se houver slot_key. */}
              {(() => {
                const order = Array.isArray(step.media_order) ? step.media_order.filter((k) => k !== "text") : [];
                const kinds = order.length > 0 ? order : (step.slot_key ? ["audio", "image", "video"] : []);
                if (kinds.length === 0) return null;
                const META: Record<string, { icon: typeof Mic; label: string }> = {
                  audio: { icon: Mic, label: "Áudio" },
                  image: { icon: ImageIcon, label: "Imagem" },
                  video: { icon: Video, label: "Vídeo" },
                };
                return (
                  <div className="flex flex-wrap gap-1">
                    {kinds.map((k, i) => {
                      const m = META[k];
                      if (!m) return null;
                      return <Pill key={k + i} icon={m.icon} label={`${order.length > 0 ? `${i + 1}· ` : ""}${m.label}`} />;
                    })}
                  </div>
                );
              })()}

              {/* Bolha do BOT */}
              {(text || buttons.length > 0 || (!step.slot_key && !reply)) && (
                <BotBubble focused={focused}>
                  {text ? (
                    <p className="whitespace-pre-wrap break-words">{text}</p>
                  ) : (
                    <p className="text-xs italic text-black/45">
                      (sem texto — escreva a mensagem ao lado)
                    </p>
                  )}
                </BotBubble>
              )}

              {/* Botões do bot — no Evolution viram lista NUMERADA em texto
                  (1, 2, 3), nunca botão nativo. O preview espelha o Evolution. */}
              {buttons.length > 0 && (
                <BotBubble focused={focused}>
                  <div className="space-y-0.5">
                    {buttons.map((b, i) => (
                      <p key={b.id} className="break-words">
                        <span className="font-semibold">{i + 1}.</span> {b.title}
                      </p>
                    ))}
                    <p className="pt-1 text-[11px] text-black/50">Responda com o número da opção.</p>
                  </div>
                </BotBubble>
              )}

              {/* Resposta simulada do CLIENTE fictício. Quando o passo tem
                  botões, no Evolution o cliente responde com o NÚMERO (ex: "1"),
                  não o texto da opção. */}
              {reply && !isOcrConta && !isOcrDoc && (
                <ClientReply reply={buttons.length > 0 ? { kind: "text", text: "1" } : reply} />
              )}

              {/* Fluxo de OCR embutido (conta/documento): foto → leitura → confirmar */}
              {(isOcrConta || isOcrDoc) && <OcrFlow kind={isOcrConta ? "conta" : "documento"} />}

              {/* Confirmação do bot após ler o dado (passos sem OCR dedicado) */}
              {confirm && !isOcrConta && !isOcrDoc && (
                <BotBubble>
                  <p className="break-words">{confirm}</p>
                </BotBubble>
              )}

              {/* Marco do envio ao portal */}
              {isFinal && (
                <div className="flex items-center justify-center gap-1.5 rounded-full bg-primary/90 px-3 py-1 text-[11px] font-medium text-white">
                  <Rocket className="h-3 w-3" />
                  Cadastro enviado ao portal iGreen
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 bg-[#F0F0F0] px-3 py-2">
        <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-xs text-black/40">Mensagem</div>
        <Mic className="h-4 w-4 text-[#075E54]" />
      </div>
    </div>
  );
}

function BotBubble({ children, focused }: { children: React.ReactNode; focused?: boolean }) {
  return (
    <div className="flex">
      <div
        className={cn(
          "relative max-w-[85%] rounded-lg rounded-tl-sm bg-white px-3 py-2 text-[13px] text-[#111B21] shadow-sm",
          focused && "ring-2 ring-primary ring-offset-1",
        )}
      >
        {children}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-black/45">
          14:32 <CheckCheck className="h-3 w-3 text-[#34B7F1]" />
        </div>
      </div>
    </div>
  );
}

function ClientReply({ reply }: { reply: { kind: "text"; text: string } | { kind: "media"; label: string } }) {
  return (
    <div className="flex justify-end">
      <div className="relative max-w-[85%] rounded-lg rounded-tr-sm bg-[#DCF8C6] px-3 py-2 text-[13px] text-[#111B21] shadow-sm">
        {reply.kind === "text" ? reply.text : <span className="italic text-black/70">{reply.label}</span>}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-black/45">
          14:33 <CheckCheck className="h-3 w-3 text-[#34B7F1]" />
        </div>
      </div>
    </div>
  );
}

function Pill({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] text-black/70 shadow-sm">
      <Icon className="h-3 w-3" />
      {label}
    </div>
  );
}

/**
 * Fluxo de OCR EMBUTIDO no preview (conta de luz ou documento). Espelha
 * EXATAMENTE o que o Evolution faz hoje: cliente envia a foto → bot lê →
 * mostra os MESMOS campos de `buildConfirmacaoConta`/`buildConfirmacaoDoc` →
 * pergunta "Está tudo correto?" e oferece opções NUMERADAS em texto (1, 2),
 * nunca botão nativo (Evolution não tem botão). Tudo fictício/ilustrativo.
 */
function OcrFlow({ kind }: { kind: "conta" | "documento" }) {
  const isConta = kind === "conta";

  // Campos idênticos ao buildConfirmacaoConta / buildConfirmacaoDoc (bot-flow.ts).
  const linhasConta: [string, string][] = [
    ["👤 Nome", "João Silva"],
    ["📍 Endereço", "Rua das Flores, 123"],
    ["🏘️ Bairro", "Centro"],
    ["🏙️ Cidade", "São Paulo - SP"],
    ["📮 CEP", "01001-000"],
    ["⚡ Distribuidora", "Enel SP"],
    ["🔢 Nº Instalação", "1234567890"],
    ["💰 Valor", "R$ 450,00"],
  ];
  const linhasDoc: [string, string][] = [
    ["👤 Nome", "João Silva"],
    ["🆔 CPF", "123.456.789-00"],
    ["🪪 RG", "12.345.678-9"],
    ["🎂 Nascimento", "01/01/1990"],
  ];
  const linhas = isConta ? linhasConta : linhasDoc;
  const titulo = isConta ? "📋 Dados da conta:" : "📋 Confirme seus dados pessoais:";

  return (
    <div className="space-y-2">
      {/* Cliente envia a foto/PDF */}
      <div className="flex justify-end">
        <div className="w-[70%] overflow-hidden rounded-lg rounded-tr-sm bg-[#DCF8C6] p-1.5 shadow-sm">
          <div className="flex h-20 items-center justify-center rounded bg-black/5">
            <FileText className="h-7 w-7 text-black/40" />
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 px-1 text-[10px] text-black/60">
            {isConta ? "conta-de-luz.jpg" : "documento.jpg"}
            <CheckCheck className="h-3 w-3 text-[#34B7F1]" />
          </div>
        </div>
      </div>

      {/* Bot lendo (automático) */}
      <BotBubble>
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#075E54]">
          <ScanLine className="h-3.5 w-3.5" /> Lendo {isConta ? "a conta" : "o documento"}…
        </div>
      </BotBubble>

      {/* Confirmação com os MESMOS campos do runtime */}
      <BotBubble>
        <p className="mb-1 font-semibold">{titulo}</p>
        <div className="space-y-0.5">
          {linhas.map(([k, v]) => (
            <p key={k} className="break-words text-[12px]">
              {k}: <span className="font-medium">{v}</span>
            </p>
          ))}
        </div>
        <p className="mt-1.5 font-medium">Está tudo correto?</p>
        <div className="mt-1 space-y-0.5 text-[12px]">
          <p><span className="font-semibold">1.</span> Sim, está tudo certo ✅</p>
          <p><span className="font-semibold">2.</span> Corrigir um dado ✏️</p>
        </div>
        <p className="pt-1 text-[11px] text-black/50">Responda com o número da opção.</p>
      </BotBubble>

      <p className="px-1 text-center text-[9px] text-black/40">
        Leitura e confirmação já vêm prontas neste passo.
      </p>
    </div>
  );
}
