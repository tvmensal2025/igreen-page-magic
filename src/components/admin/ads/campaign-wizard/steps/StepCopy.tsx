/**
 * StepCopy — Step 3: título, texto, descrição + primeira mensagem WhatsApp.
 *
 * MUDANÇA jul/2026: o pack de copy agora vem do catálogo local (200 opções
 * curadas) — sem loading, sem depender de IA. Botões:
 *   🔄 Sortear outras 5    → re-embaralha instantaneamente
 *   📚 Ver 200 opções      → abre catálogo completo com filtro por ângulo
 *   ✨ Adaptar com IA      → chama Gemini como refinamento OPCIONAL
 */
import { useState } from "react";
import { Loader2, Wand2, Smartphone, X, Shuffle, BookOpen, Sparkles } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
          <BookOpen className="w-3 h-3 inline mr-1" /> Sugestões do catálogo ({CATALOG_TOTALS.total} copies prontos)
        </span>
        <button
          type="button"
          onClick={copyLogic.reshuffleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-background border border-border hover:border-primary"
        >
          <Shuffle className="w-3 h-3" /> Sortear outras
        </button>
        <button
          type="button"
          onClick={() => setCatalogOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-background border border-border hover:border-primary"
        >
          <BookOpen className="w-3 h-3" /> Ver todas ({CATALOG_TOTALS.total})
        </button>
        <button
          type="button"
          onClick={copyLogic.adaptCopyWithAI}
          disabled={state.copyLoading}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-[hsl(var(--ads-emerald-2))] text-white hover:opacity-90 disabled:opacity-50"
        >
          {state.copyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Adaptar com IA
        </button>
      </div>

      {/* Título */}
      <div>

        <Label className="flex justify-between">
          <span>Título principal</span>
          <span className={`text-[10px] ${state.headline.length > COPY_LIMITS.headline ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>{state.headline.length}/{COPY_LIMITS.headline}</span>
        </Label>
        <Input maxLength={COPY_LIMITS.headline} value={state.headline}
          onChange={(e) => patch({ headline: e.target.value })} placeholder="Conta 20% mais barata" />
        {copy && copy.headlines.length > 1 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {(copy.variations?.headlines || copy.headlines.map((t) => ({ text: t, framework: "geral", score: 75 }))).map((h, i) => (
              <button key={i} onClick={() => patch({ headline: h.text })}
                className={`ads-select-card text-xs flex items-center justify-between gap-2 ${state.headline === h.text ? "is-active" : ""}`}>
                <span className="truncate">{h.text}</span>
                <span className="flex items-center gap-1 shrink-0 text-[9px] uppercase text-[hsl(var(--ads-muted))]">{h.framework} · {h.score}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Texto principal */}
      <div>
        <Label className="flex justify-between">
          <span>Texto principal</span>
          <span className={`text-[10px] ${state.primaryText.length > COPY_LIMITS.primary ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>{state.primaryText.length}/{COPY_LIMITS.primary}</span>
        </Label>
        <Textarea rows={3} maxLength={COPY_LIMITS.primary} value={state.primaryText}
          onChange={(e) => patch({ primaryText: e.target.value })} placeholder="Sua conta de luz 20% mais barata. Sem obra. Fala no zap 👇" />
        {copy && copy.primary_texts.length > 1 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {(copy.variations?.primary_texts || copy.primary_texts.map((t) => ({ text: t, framework: "geral", score: 75 }))).map((t, i) => (
              <button key={i} onClick={() => patch({ primaryText: t.text })}
                className={`ads-select-card text-xs ${state.primaryText === t.text ? "is-active" : ""}`}>
                <div className="text-[9px] uppercase text-[hsl(var(--ads-muted))] mb-0.5">{t.framework} · {t.score}/100</div>
                <div className="line-clamp-2">{t.text}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Descrição */}
      <div>
        <Label className="flex justify-between">
          <span>Descrição curta</span>
          <span className={`text-[10px] ${state.description.length > COPY_LIMITS.description ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>{state.description.length}/{COPY_LIMITS.description}</span>
        </Label>
        <Input maxLength={COPY_LIMITS.description} value={state.description}
          onChange={(e) => patch({ description: e.target.value })} placeholder="Sem obra. Sem taxa." />
      </div>

      {/* Primeira mensagem WhatsApp */}
      <div className="rounded-xl border border-[hsl(var(--ads-emerald-2))]/20 bg-primary/5 p-3 space-y-2">
        <Label className="flex justify-between items-center">
          <span className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" /> Primeira mensagem no WhatsApp</span>
          <span className={`text-[10px] ${state.initialMessage.length > INITIAL_MSG_LIMIT ? "text-destructive" : "text-[hsl(var(--ads-muted))]"}`}>{state.initialMessage.length}/{INITIAL_MSG_LIMIT}</span>
        </Label>
        <p className="text-[11px] text-[hsl(var(--ads-muted))] leading-snug">
          É o que aparece escrito quando o cliente clicar no anúncio. Curto, em 1ª pessoa, como se fosse o cliente falando.
        </p>
        <Textarea rows={2} maxLength={INITIAL_MSG_LIMIT} value={state.initialMessage}
          onChange={(e) => patch({ initialMessage: e.target.value, initialMessageTouched: true })}
          placeholder="Olá! Quero saber mais sobre a redução na conta de luz."
          className={state.initialMsgDuplicate ? "border-destructive focus-visible:ring-destructive" : ""} />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onClick={copyLogic.handleVaryInitialMessage} disabled={state.initialMsgVarying}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--ads-emerald-2))] hover:opacity-80 disabled:opacity-50">
            {state.initialMsgVarying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} Variar com IA (mantém o foco)
          </button>
          {state.initialMsgChecking && <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--ads-muted))]"><Loader2 className="w-3 h-3 animate-spin" /> verificando…</span>}
        </div>
        {state.initialMsgDuplicate && (
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            <X className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Essa frase já está em uso em <strong>outra campanha sua</strong>. Mude um pouco (ou toque em <strong>Variar com IA</strong>) para medir cada campanha com precisão.</span>
          </div>
        )}
        {state.initialMessageTouched && (
          <button type="button"
            onClick={() => patch({ initialMessage: buildDefaultInitialMessage(derived.distribuidoraPrimary), initialMessageTouched: false })}
            className="text-[10px] text-[hsl(var(--ads-muted))] hover:text-foreground underline underline-offset-2">
            voltar para a sugestão automática
          </button>
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
