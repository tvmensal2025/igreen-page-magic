import { useState } from "react";
import { Loader2, Wand2, Smartphone, X, Shuffle, BookOpen, Sparkles, Brain, MessageSquare, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AdQualityPanel } from "../../AdQualityPanel";
import { CopyCatalogSheet } from "../CopyCatalogSheet";
import { COPY_LIMITS, INITIAL_MSG_LIMIT, buildDefaultInitialMessage, type AdFormat } from "../wizardHelpers";
import { CATALOG_TOTALS } from "@/data/copyCatalog";
import type { WizardState } from "../hooks/useWizardState";
import type { WizardDerived } from "../hooks/useWizardState";
import type { useCopyLogic } from "../hooks/useCopyLogic";

interface Props {
  state: WizardState;
  derived: WizardDerived;
  patch: (p: Partial<WizardState>) => void;
  copyLogic: ReturnType<typeof useCopyLogic>;
}

export function StepCopy({ state, derived, patch, copyLogic }: Props) {
  const { copy } = state;
  const [catalogOpen, setCatalogOpen] = useState(false);
  const isStoryOnly = state.format === "story";

  const primaryImage = state.creativeMode === "video" ? null : (() => {
    const f = state.filesByFormat.vertical[0] || state.filesByFormat.square[0] || state.filesByFormat.story[0];
    const fmt: AdFormat = state.filesByFormat.vertical[0] ? "vertical" : state.filesByFormat.square[0] ? "square" : "story";
    return f ? { url: f.url, w: f.w, h: f.h, format: fmt } : null;
  })();

  return (
    <div className="space-y-4">
      {/* Barra de ações do catálogo */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--ads-emerald-2))]/20 bg-primary/5 p-2.5">
        <span className="text-[11px] text-[hsl(var(--ads-muted))] mr-auto">
          <BookOpen className="w-3 h-3 inline mr-1" /> Sugestões ({CATALOG_TOTALS.total} opções)
        </span>
        <button
          type="button"
          onClick={copyLogic.reshuffleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-background border border-border hover:border-primary"
        >
          <Shuffle className="w-3 h-3" /> Sortear
        </button>
        <button
          type="button"
          onClick={copyLogic.adaptCopyWithAI}
          disabled={state.copyLoading}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-[hsl(var(--ads-emerald-2))] text-white hover:opacity-90 disabled:opacity-50"
        >
          {state.copyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          IA
        </button>
      </div>

      {/* Título */}
      <div className="space-y-1.5">
        <Label className="flex justify-between items-center text-sm font-semibold">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" /> Título (Headline)
          </span>
          <span className={`text-[10px] ${state.headline.length > COPY_LIMITS.headline ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>
            {state.headline.length}/{COPY_LIMITS.headline}
          </span>
        </Label>
        <Input 
          maxLength={COPY_LIMITS.headline} 
          value={state.headline}
          onChange={(e) => patch({ headline: e.target.value })} 
          placeholder={isStoryOnly ? "Ex: Seja um parceiro iGreen!" : "Ex: Reduza sua conta de luz"}
          className="bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))]"
        />
        {copy && copy.headlines.length > 1 && (
          <div className="flex flex-col gap-1 mt-2">
            {(copy.variations?.headlines || copy.headlines.map((t) => ({ text: t, framework: "geral", score: 75 }))).slice(0, 3).map((h, i) => (
              <button key={i} onClick={() => patch({ headline: h.text })}
                className={`ads-select-card text-[11px] py-1.5 flex items-center justify-between gap-2 ${state.headline === h.text ? "is-active" : ""}`}>
                <span className="truncate">{h.text}</span>
                <span className="shrink-0 text-[8px] opacity-60">{h.score}%</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Texto principal */}
      <div className="space-y-1.5">
        <Label className="flex justify-between items-center text-sm font-semibold">
          <span className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" /> Texto Principal
          </span>
          <span className={`text-[10px] ${state.primaryText.length > COPY_LIMITS.primary ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>
            {state.primaryText.length}/{COPY_LIMITS.primary}
          </span>
        </Label>
        <Textarea 
          rows={3} 
          maxLength={COPY_LIMITS.primary} 
          value={state.primaryText}
          onChange={(e) => patch({ primaryText: e.target.value })} 
          placeholder="Texto persuasivo do anúncio."
          className="bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))]"
        />
        {copy && copy.primary_texts.length > 1 && (
          <div className="flex flex-col gap-1 mt-2">
            {(copy.variations?.primary_texts || copy.primary_texts.map((t) => ({ text: t, framework: "geral", score: 75 }))).slice(0, 2).map((t, i) => (
              <button key={i} onClick={() => patch({ primaryText: t.text })}
                className={`ads-select-card text-[11px] py-1.5 ${state.primaryText === t.text ? "is-active" : ""}`}>
                <div className="line-clamp-2 text-left">{t.text}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Separator className="bg-[hsl(var(--ads-border))]/50" />

      {/* Primeira mensagem WhatsApp */}
      <div className="rounded-xl border border-[hsl(var(--ads-emerald-2))]/20 bg-primary/5 p-3 space-y-2">
        <Label className="flex justify-between items-center text-sm font-semibold">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" /> Mensagem do Cliente
          </span>
          <span className={`text-[10px] ${state.initialMessage.length > INITIAL_MSG_LIMIT ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>
            {state.initialMessage.length}/{INITIAL_MSG_LIMIT}
          </span>
        </Label>
        <Textarea 
          rows={2} 
          maxLength={INITIAL_MSG_LIMIT} 
          value={state.initialMessage}
          onChange={(e) => patch({ initialMessage: e.target.value, initialMessageTouched: true })}
          placeholder="Olá! Quero saber mais sobre a iGreen."
          className={`text-sm italic bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))] ${state.initialMsgDuplicate ? "border-destructive focus-visible:ring-destructive" : ""}`} 
        />
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={copyLogic.handleVaryInitialMessage} disabled={state.initialMsgVarying}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--ads-emerald-2))] hover:opacity-80 disabled:opacity-50">
            {state.initialMsgVarying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} Variar com IA
          </button>
          {state.initialMsgChecking && <span className="text-[9px] opacity-60">verificando…</span>}
        </div>
        {state.initialMsgDuplicate && (
          <div className="flex items-start gap-1.5 text-[10px] text-destructive">
            <X className="w-3 h-3 mt-0.5" /> Frase em uso. Mude um pouco.
          </div>
        )}
      </div>

      {/* Score de qualidade */}
      <AdQualityPanel
        headline={state.headline} primary={state.primaryText} description={state.description}
        cityCount={state.cities.length} distribuidora={derived.distribuidoraPrimary}
        primaryImage={primaryImage}
        primaryVideo={state.creativeMode === "video" && state.videoMeta ? { w: state.videoMeta.w, h: state.videoMeta.h, duration: state.videoMeta.duration } : null}
        onChange={(q) => patch({ quality: q })}
      />

      <CopyCatalogSheet
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        distribuidora={derived.distribuidoraPrimary}
        cidade={state.cities[0]?.name || null}
        onPickHeadline={(t) => patch({ headline: t })}
        onPickPrimary={(t) => patch({ primaryText: t })}
        onPickDescription={(t) => patch({ description: t })}
      />
    </div>
  );
}