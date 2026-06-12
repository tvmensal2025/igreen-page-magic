/**
 * WizardPreview — Painel direito com preview CONTEXTUAL por passo.
 * Cada passo mostra o preview certo:
 *  1 Região   → mapa-resumo (cidades/distribuidoras + alcance)
 *  2 Criativo → as fotos/vídeo enviados, no formato real
 *  3 Texto    → celular WhatsApp + card do anúncio (o que o lead vê)
 *  4 Orçamento→ resumo de gasto e conversas estimadas
 *  5 Revisar  → card do anúncio completo
 * Cores: verde oficial iGreen (tokens --ads-* no escopo .ads-wizard-scope).
 */
import { MapPin, TrendingUp, ImageIcon, DollarSign, Video } from "lucide-react";
import type { WizardState } from "./hooks/useWizardState";

interface Props {
  step: number;
  state: WizardState;
  pageName: string;
  whatsappNumber: string;
}

export function WizardPreview({ step, state, pageName, whatsappNumber }: Props) {
  return (
    <aside className="w-[320px] shrink-0 bg-[hsl(var(--ads-surface-2))] border-l border-[hsl(var(--ads-border))] p-5 hidden xl:flex flex-col items-center gap-4 overflow-y-auto">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-[hsl(var(--ads-muted))] self-start">
        {step === 1 && "Resumo da região"}
        {step === 2 && "Preview do criativo"}
        {step === 3 && "O que o lead vê"}
        {step === 4 && "Resumo do investimento"}
        {step === 5 && "Anúncio final"}
      </div>

      {step === 1 && <RegionPreview state={state} />}
      {step === 2 && <CreativePreview state={state} />}
      {(step === 3 || step === 5) && (
        <AdPreviewBlock state={state} pageName={pageName} whatsappNumber={whatsappNumber} showPhone={step === 3} />
      )}
      {step === 4 && <BudgetPreview state={state} />}
    </aside>
  );
}

/* ── Passo 1: resumo da região ─────────────────────────────────────── */
function RegionPreview({ state }: { state: WizardState }) {
  const reach = state.liveReach;
  const isRadius = state.geoMode === "radius";
  return (
    <div className="w-full space-y-3">
      <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-4 text-center">
        <MapPin className="w-8 h-8 mx-auto text-[hsl(var(--ads-emerald))]" />
        <div className="text-3xl font-black text-[hsl(var(--ads-emerald-2))] mt-2">
          {isRadius ? state.radiusPoints.length : state.cities.length}
        </div>
        <div className="text-[11px] text-[hsl(var(--ads-muted))]">
          {isRadius ? "endereço(s) com raio" : "cidade(s) selecionada(s)"}
        </div>
      </div>
      {!isRadius && state.cities.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-3">
          <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--ads-muted))] mb-1.5">Primeiras cidades</div>
          <div className="flex flex-wrap gap-1">
            {state.cities.slice(0, 8).map((c) => (
              <span key={c.key} className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--ads-emerald)/.1)] text-[hsl(var(--ads-emerald-2))]">{c.name}</span>
            ))}
            {state.cities.length > 8 && <span className="text-[10px] text-[hsl(var(--ads-muted))]">+{state.cities.length - 8}</span>}
          </div>
        </div>
      )}
      {reach && (
        <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-3">
          <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--ads-muted))] flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3" /> Alcance estimado
          </div>
          <div className="text-sm font-bold text-[hsl(var(--ads-emerald-2))]">
            {reach.lower.toLocaleString("pt-BR")}–{reach.upper.toLocaleString("pt-BR")} pessoas
          </div>
        </div>
      )}
      {state.cities.length === 0 && !isRadius && (
        <div className="text-[11px] text-center text-[hsl(var(--ads-muted))]">Busque cidades para ver o resumo aqui.</div>
      )}
    </div>
  );
}

/* ── Passo 2: preview do criativo ──────────────────────────────────── */
function CreativePreview({ state }: { state: WizardState }) {
  if (state.creativeMode === "video") {
    return (
      <div className="w-full">
        {state.videoUrl ? (
          <div className="rounded-xl overflow-hidden border border-[hsl(var(--ads-emerald)/.4)] bg-black mx-auto max-w-[220px]">
            <video src={state.videoUrl} controls playsInline className="w-full aspect-[9/16] object-cover" />
          </div>
        ) : (
          <Placeholder icon={<Video className="w-8 h-8" />} text="Envie um vídeo Reels para ver aqui" />
        )}
      </div>
    );
  }
  const fmt = state.format;
  // Junta as fotos enviadas (filesByFormat) com as escolhidas da biblioteca (pickedLibrary).
  const uploaded = state.filesByFormat[fmt].map((f) => f.url);
  const fromLibrary = state.pickedLibrary.filter((it) => it.format === fmt).map((it) => it.url);
  const urls = [...uploaded, ...fromLibrary];
  const aspect = fmt === "story" || fmt === "vertical" ? "aspect-[9/16]" : "aspect-square";
  if (urls.length === 0) return <Placeholder icon={<ImageIcon className="w-8 h-8" />} text="Envie ou escolha fotos para ver o preview" />;
  return (
    <div className="w-full space-y-2">
      <div className={`rounded-xl overflow-hidden border-2 border-[hsl(var(--ads-emerald)/.4)] mx-auto max-w-[240px] ${aspect}`}>
        <img src={urls[0]} alt="" className="w-full h-full object-cover" />
      </div>
      {urls.length > 1 && (
        <div className="flex gap-1.5 justify-center flex-wrap">
          {urls.slice(0, 4).map((u, i) => (
            <div key={`${u}-${i}`} className="w-12 h-12 rounded-lg overflow-hidden border border-[hsl(var(--ads-border))]">
              <img src={u} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-center text-[hsl(var(--ads-muted))]">A 1ª foto é a principal — Meta testa as demais.</div>
    </div>
  );
}

/* ── Passos 3 e 5: celular WhatsApp + card do anúncio ──────────────── */
function AdPreviewBlock({ state, pageName, whatsappNumber, showPhone }: {
  state: WizardState; pageName: string; whatsappNumber: string; showPhone: boolean;
}) {
  // Imagem principal: tenta as enviadas em qualquer formato, depois a biblioteca.
  const imageUrl =
    state.filesByFormat.square[0]?.url ||
    state.filesByFormat.vertical[0]?.url ||
    state.filesByFormat.story[0]?.url ||
    state.pickedLibrary[0]?.url ||
    null;
  return (
    <div className="w-full flex flex-col items-center gap-4">
      {showPhone && (
        <div className="w-[230px] rounded-[28px] overflow-hidden shadow-xl border-[3px] border-[hsl(var(--ads-border))]">
          <div className="h-8 bg-[#075E54] flex items-center justify-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#25D366]" />
            <span className="text-[10px] text-white font-medium">WhatsApp Business</span>
          </div>
          <div className="min-h-[200px] bg-[#ECE5DD] p-3 flex flex-col justify-end gap-2">
            <div className="flex justify-end">
              <div className="bg-[#DCF8C6] text-[#111b21] text-[11px] px-3 py-2 rounded-xl rounded-tr-sm max-w-[85%] leading-snug shadow-sm">
                {state.initialMessage || <span className="opacity-50 italic">a primeira mensagem aparece aqui</span>}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="bg-white text-[#111b21] text-[11px] px-3 py-2 rounded-xl rounded-tl-sm max-w-[85%] leading-snug shadow-sm">
                Olá! 👋 Que bom que se interessou! Vou te explicar como funciona...
              </div>
            </div>
          </div>
        </div>
      )}

      {(state.headline || state.primaryText || imageUrl) ? (
        <div className="w-full rounded-xl overflow-hidden border border-[hsl(var(--ads-border))] bg-white shadow-lg">
          <div className="aspect-square bg-[hsl(var(--ads-emerald)/.06)] flex items-center justify-center">
            {imageUrl ? <img src={imageUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-[hsl(var(--ads-muted))] text-xs">Imagem do anúncio</span>}
          </div>
          <div className="p-3 space-y-1 bg-white">
            <div className="text-[10px] text-gray-500"><span className="font-medium text-gray-700">{pageName}</span> · Patrocinado</div>
            {state.headline && <div className="text-[12px] font-bold text-gray-900 leading-tight">{state.headline}</div>}
            {state.primaryText && <div className="text-[11px] text-gray-600 leading-snug line-clamp-2">{state.primaryText}</div>}
          </div>
          <div className="px-3 pb-3 bg-white">
            <div className="bg-[#25D366] text-white text-center text-[11px] font-bold py-2 rounded-lg">💬 Enviar mensagem</div>
          </div>
        </div>
      ) : (
        <Placeholder icon={<ImageIcon className="w-8 h-8" />} text="Preencha o texto para ver o anúncio" />
      )}

      {whatsappNumber && (
        <div className="text-[10px] text-center text-[hsl(var(--ads-muted))]">
          Destino: <span className="text-[hsl(var(--ads-emerald-2))] font-mono">{whatsappNumber}</span>
        </div>
      )}
    </div>
  );
}

/* ── Passo 4: resumo de investimento ──────────────────────────────── */
function BudgetPreview({ state }: { state: WizardState }) {
  const total = state.duration === 0 ? state.budget * 30 : state.budget * state.duration;
  const dailyLeads = `${Math.max(1, Math.round(state.budget / 6))}–${Math.round(state.budget / 3)}`;
  return (
    <div className="w-full space-y-3">
      <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-4 text-center">
        <DollarSign className="w-8 h-8 mx-auto text-[hsl(var(--ads-emerald))]" />
        <div className="text-3xl font-black text-[hsl(var(--ads-emerald-2))] mt-2">R$ {state.budget}<span className="text-sm font-normal text-[hsl(var(--ads-muted))]">/dia</span></div>
        <div className="text-[11px] text-[hsl(var(--ads-muted))]">{state.duration === 0 ? "contínuo (até pausar)" : `por ${state.duration} dias`}</div>
      </div>
      <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-3 flex items-center justify-between">
        <span className="text-[11px] text-[hsl(var(--ads-muted))]">Total estimado</span>
        <strong className="text-sm text-[hsl(var(--ads-emerald-2))]">R$ {total}{state.duration === 0 ? "/mês" : ""}</strong>
      </div>
      <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-3 text-center">
        <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--ads-muted))]">Conversas/dia estimadas</div>
        <div className="text-xl font-black text-[hsl(var(--ads-emerald-2))]">{dailyLeads}</div>
      </div>
    </div>
  );
}

function Placeholder({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="w-full rounded-xl border border-dashed border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-8 flex flex-col items-center gap-2 text-[hsl(var(--ads-muted))]">
      {icon}
      <div className="text-[11px] text-center max-w-[180px]">{text}</div>
    </div>
  );
}
