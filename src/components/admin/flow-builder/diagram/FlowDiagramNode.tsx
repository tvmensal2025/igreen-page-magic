/**
 * `FlowDiagramNode` — Nó padrão do Modo_Diagrama.
 *
 * Equivalente visual ao `StepCard` da lista, adaptado ao layout React Flow:
 * - `Handle` `target` à esquerda (id `"default"`).
 * - `Handle` `source` default à direita (id `"default"`).
 * - 1 `Handle` `source` extra por `Botao_Interativo` com id `"btn:<button.id>"`
 *   posicionado verticalmente ao lado do botão correspondente (R7.3).
 *
 * Renderiza:
 * - Posição `#position`, emoji do `step_type`, título truncado em 60 chars (R2.2/R2.3).
 * - Preview de `message_text` truncado em 80 chars via `renderVarsPreview` (R2.2).
 * - Badges: "IA livre · Gemini" (R8.1) com tooltip do `ai_prompt` truncado em 200
 *   chars ou "Sem prompt customizado" (R8.5); OCR (R8.2/R8.3); contadores de
 *   mídia, botões e regras (paridade visual com `StepCard`).
 * - `WarningBadge` no canto superior esquerdo (R3.9).
 *
 * Opacidade efetiva combina `data.opacity` (já considera R2.4 `is_active` ↔ R3.7
 * seleção, com regra de menor opacidade R2.5) com atenuação adicional por busca
 * (R19): quando `searchState === "dim"`, aplica `min(data.opacity, 0.3)`.
 *
 * Acessibilidade:
 * - `role="button"`, `tabIndex={0}` (R14.6).
 * - `aria-label` em pt-BR: `"Passo {position}: {title}, tipo {step_type_label}"`.
 * - Foco visível com contraste mínimo 3:1 via `focus-visible:ring-2
 *   focus-visible:ring-primary` (R14.1).
 *
 * Mapeia para: R2.2, R2.3, R2.4, R3.7, R3.9, R7.1, R7.3, R7.5, R8.1, R8.2,
 * R8.3, R8.5, R14.1, R14.6.
 */

import { memo } from "react";
import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  ScanLine,
  Sparkles,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  STEP_TYPE_OPTIONS,
  getButtons,
  renderVarsPreview,
  type Step,
} from "@/components/admin/flow-builder/flowTypes";
import type { FlowDiagramNode as FlowDiagramNodeType } from "@/hooks/useDiagramData";
import { WarningBadge } from "@/components/admin/flow-builder/diagram/WarningBadge";
import { getStepTypeColor } from "@/components/admin/flow-builder/diagram/stepTypeColors";

// ---------------------------------------------------------------------------
// Constantes de truncamento e atenuação
// ---------------------------------------------------------------------------

/** R2.2 — título no cartão truncado em 60 chars. */
const TITLE_MAX_LEN = 60;
/** R2.2 — preview do `message_text` truncado em 80 chars. */
const PREVIEW_MAX_LEN = 80;
/** R7.1 — título do botão truncado em 20 chars (paridade com runtime). */
const BUTTON_TITLE_MAX_LEN = 20;
/** R8.5 — tooltip do `ai_prompt` truncado em 200 chars com reticências. */
const AI_PROMPT_TOOLTIP_MAX_LEN = 200;
/** R19 — atenuação adicional aplicada quando `searchState === "dim"`.
 *
 * Alinhado a R3.7/R19.5 da spec: "no máximo 30%" é o teto; aplicamos 0.3
 * para garantir que o nó visivelmente "apaga". O Consultor sabe que esse
 * nó NÃO casou com a busca; clicar fora do input ou pressionar `Esc`
 * (R19.5) restaura a opacidade. */
const SEARCH_DIM_OPACITY = 0.3;

// Altura aproximada do cabeçalho onde o handle default fica alinhado.
// Mantém o ponto de saída visualmente no centro do card quando não há botões.
const DEFAULT_HANDLE_TOP = 48;

// Espaçamento vertical entre os handles dos botões. Cada linha de botão tem
// altura ~28px no layout abaixo (`py-1` + texto small).
const BUTTON_HANDLE_SPACING = 28;
// Offset vertical para o primeiro handle de botão. Calculado para começar
// abaixo da área de cabeçalho + badges + handle default (~120px), evitando
// sobreposição visual com o handle "default" no `top: 48`.
const BUTTON_HANDLE_OFFSET_TOP = 132;

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** Trunca preservando início, com reticências unicode "…". */
function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}

/** Resolve o rótulo legível do `step_type` para o `aria-label` em pt-BR. */
function resolveStepTypeLabel(step: Step): string {
  const meta = STEP_TYPE_OPTIONS.find((t) => t.value === step.step_type);
  return meta?.label ?? step.step_type;
}

/** Resolve o emoji do `step_type` (fallback para o primeiro tipo). */
function resolveStepTypeEmoji(step: Step): string {
  const meta = STEP_TYPE_OPTIONS.find((t) => t.value === step.step_type);
  return meta?.emoji ?? STEP_TYPE_OPTIONS[0].emoji;
}

/**
 * Resolve o conteúdo do tooltip do badge "IA livre · Gemini" (R8.5):
 * - `fallback.ai_prompt` truncado em 200 chars quando o passo está em modo
 *   `"ai"`/`"ai_limit"` E o prompt tem conteúdo não-vazio após trim.
 * - "Sem prompt customizado" caso contrário.
 *
 * Observação: o tipo atual `FallbackMode` lista `"ai" | "ai_limit"` (sem
 * `"ai_answer"`). Aceitamos ambas as strings para tolerar fluxos legados.
 */
function resolveAiPromptTooltip(step: Step): string {
  const fallback = step.fallback;
  const mode = (fallback?.mode ?? "") as string;
  const isAiMode = mode === "ai" || mode === "ai_answer" || mode === "ai_limit";
  const prompt = (fallback?.ai_prompt ?? "").trim();
  if (!isAiMode || prompt === "") {
    return "Sem prompt customizado";
  }
  return truncate(prompt, AI_PROMPT_TOOLTIP_MAX_LEN);
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

function FlowDiagramNodeImpl({ data, selected }: NodeProps<FlowDiagramNodeType>) {
  const {
    step,
    mediaCount,
    warnings,
    isAiAnswer,
    ocrKind,
    metrics,
    searchState,
    opacity: opacityFromData,
  } = data;

  const buttons = getButtons(step);
  const stepTypeLabel = resolveStepTypeLabel(step);
  const stepTypeEmoji = resolveStepTypeEmoji(step);
  const typeColor = getStepTypeColor(step.step_type);

  // Título: truncado a 60 chars, com fallback "sem título" (R2.3).
  const titleRaw = step.title?.trim() ?? "";
  const titleDisplayed =
    titleRaw === ""
      ? "sem título"
      : truncate(titleRaw, TITLE_MAX_LEN);

  // Preview: aplica `renderVarsPreview`, depois trunca em 80 chars.
  // Quando `message_text` é vazio/nulo, omite a área inteira (R2.3).
  const previewRendered = renderVarsPreview(step.message_text);
  const previewTruncated = truncate(previewRendered, PREVIEW_MAX_LEN);
  const previewVisible = previewRendered.length > 0;

  // Tooltip do badge IA (R8.5).
  const aiPromptTooltip = isAiAnswer ? resolveAiPromptTooltip(step) : "";

  // R19 — atenuação adicional para nós em estado "dim" da busca (R19.5).
  // R2.5 já está embutido em `opacityFromData` (faixa "inativa" ↔ seleção).
  const effectiveOpacity =
    searchState === "dim"
      ? Math.min(opacityFromData, SEARCH_DIM_OPACITY)
      : opacityFromData;

  // R14.6 — aria-label em pt-BR no formato exigido.
  const ariaLabel = `Passo ${step.position}: ${titleRaw === "" ? "sem título" : titleRaw}, tipo ${stepTypeLabel}`;

  // Pluralização simples para o badge de regras/botões (paridade com `StepCard`).
  const transitionCount = step.transitions.length;
  const buttonCount = buttons.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-selected={selected}
      aria-disabled={!step.is_active}
      data-step-id={step.id}
      data-search-state={searchState ?? "neutral"}
      style={{ opacity: effectiveOpacity }}
      className={cn(
        // Base: largura mínima generosa para acomodar título + preview + badges.
        // `overflow-hidden` recorta a barra colorida lateral (`stripe`).
        "relative w-[280px] overflow-hidden rounded-xl border bg-card pl-4 pr-3 py-3 text-left shadow-sm",
        "transition-all duration-150",
        // Foco visível com contraste suficiente (R14.1) — anel primário 2px
        // com offset, alinhado ao restante do design system.
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        // Borda destacada quando selecionado (paridade com `StepCard`).
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:shadow-md",
        // Realce de match na busca (R19) — anel âmbar mais forte e
        // box-shadow para destacar contra o fundo, visível em ambos os temas.
        searchState === "match" &&
          "ring-2 ring-warning shadow-[0_0_0_4px_hsl(38_92%_50%_/_0.15)]",
      )}
    >
      {/* Barra colorida lateral por step_type — reforço visual rápido do tipo. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1.5",
          typeColor.stripe,
          !step.is_active && "opacity-40",
        )}
      />
      {/* Handle de entrada (target) — sempre presente, à esquerda. */}
      <Handle
        type="target"
        position={Position.Left}
        id="default"
        className="!h-2.5 !w-2.5 !border !border-border !bg-background"
      />

      {/* Warning badge no canto superior esquerdo (R3.9). */}
      {warnings.length > 0 && <WarningBadge warnings={warnings} />}

      {/* ── Cabeçalho: posição + emoji + título + badge "inativo" ── */}
      <div className="flex items-start gap-2">
        {/* Posição + emoji */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            #{step.position}
          </span>
          <div
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg text-base ring-1 ring-inset ring-border/40",
              typeColor.accentBg,
              typeColor.accentText,
            )}
          >
            <span aria-hidden="true">{stepTypeEmoji}</span>
          </div>
        </div>

        {/* Título + flag inativo */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4
              className={cn(
                "min-w-0 truncate text-sm font-semibold",
                titleRaw === "" && "italic text-muted-foreground",
              )}
              title={titleRaw}
            >
              {titleDisplayed}
            </h4>
            {!step.is_active && (
              <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                inativo
              </Badge>
            )}
          </div>

          {/* Preview do message_text (omitido quando vazio — R2.3). */}
          {previewVisible && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {previewTruncated}
            </p>
          )}
        </div>
      </div>

      {/* ── Badges (paridade visual com StepCard) ── */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* IA livre · Gemini (R8.1 + tooltip R8.5). */}
        {isAiAnswer && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="h-5 cursor-help gap-1 bg-primary/15 text-[10px] text-primary dark:text-primary"
                  // `tabIndex` no Badge para tornar o tooltip acessível por foco.
                  tabIndex={0}
                  aria-label="Passo IA livre · Gemini"
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  IA livre · Gemini
                </Badge>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs whitespace-normal text-xs"
              >
                {aiPromptTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* OCR ativo (R8.2) ou desligado (R8.3). */}
        {!isAiAnswer && ocrKind && (() => {
          const on = step.auto_detect_doc_type !== false;
          const labelKind = ocrKind === "conta" ? "conta" : "documento";
          return (
            <Badge
              variant="secondary"
              className={cn(
                "h-5 gap-1 text-[10px]",
                on
                  ? "bg-primary/15 text-primary dark:text-primary"
                  : "bg-muted text-muted-foreground",
              )}
              aria-label={
                on
                  ? `OCR ${labelKind} ativo`
                  : `OCR ${labelKind} desligado`
              }
            >
              <ScanLine className="h-3 w-3" aria-hidden="true" />
              {on ? `OCR ${labelKind}` : `OCR ${labelKind} (desligado)`}
            </Badge>
          );
        })()}

        {/* Contadores de mídia. */}
        {mediaCount && mediaCount.audio > 0 && (
          <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
            <Mic className="h-3 w-3" aria-hidden="true" />
            {mediaCount.audio}
          </Badge>
        )}
        {mediaCount && mediaCount.image > 0 && (
          <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
            <ImageIcon className="h-3 w-3" aria-hidden="true" />
            {mediaCount.image}
          </Badge>
        )}
        {mediaCount && mediaCount.video > 0 && (
          <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
            <Video className="h-3 w-3" aria-hidden="true" />
            {mediaCount.video}
          </Badge>
        )}

        {/* Contador de botões. */}
        {buttonCount > 0 && (
          <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {buttonCount} {buttonCount === 1 ? "botão" : "botões"}
          </Badge>
        )}

        {/* Contador de regras (transitions). */}
        {transitionCount > 0 && (
          <Badge variant="outline" className="h-5 text-[10px]">
            {transitionCount} {transitionCount === 1 ? "regra" : "regras"}
          </Badge>
        )}
      </div>

      {/* ── Linha de métricas (R9.4–R9.7, exibida apenas quando habilitada) ── */}
      {metrics && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          {typeof metrics.abandonmentPct === "number" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono",
                metrics.abandonmentPct >= 50
                  ? "bg-destructive/10 text-destructive"
                  : metrics.abandonmentPct >= 25
                    ? "bg-warning/15 text-warning dark:text-warning"
                    : "bg-primary/15 text-primary dark:text-primary",
              )}
              aria-label={`Taxa de abandono: ${metrics.abandonmentPct.toFixed(1)} por cento`}
              title="Taxa de abandono nos últimos 30 dias"
            >
              ↓ {metrics.abandonmentPct.toFixed(1)}%
            </span>
          )}
          {isAiAnswer && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono",
                typeof metrics.avgConfidence !== "number"
                  ? "bg-muted text-muted-foreground"
                  : metrics.avgConfidence >= 0.8
                    ? "bg-primary/15 text-primary dark:text-primary"
                    : metrics.avgConfidence >= 0.5
                      ? "bg-warning/15 text-warning dark:text-warning"
                      : "bg-destructive/10 text-destructive",
              )}
              aria-label={
                typeof metrics.avgConfidence === "number"
                  ? `Confiança média da IA: ${metrics.avgConfidence.toFixed(1)}`
                  : "Confiança média da IA: sem dados"
              }
              title="Confiança média da IA (R8.6/R8.7)"
            >
              IA{" "}
              {typeof metrics.avgConfidence === "number"
                ? metrics.avgConfidence.toFixed(1)
                : "—"}
            </span>
          )}
          {typeof metrics.avgDurationS === "number" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono"
              aria-label={`Tempo médio: ${metrics.avgDurationS.toFixed(0)} segundos`}
              title="Tempo médio neste passo"
            >
              ⏱ {metrics.avgDurationS.toFixed(0)}s
            </span>
          )}
        </div>
      )}

      {/* ── Lista de botões interativos com handles dedicados (R7.1, R7.3) ── */}
      {buttonCount > 0 && (
        <div className="relative mt-2 space-y-1 border-t border-border/60 pt-2">
          {/* Aviso quando há mais de 3 botões (R7.2). */}
          {buttonCount > 3 && (
            <div className="flex items-start gap-1 rounded-md bg-warning/10 px-2 py-1 text-[10px] text-warning dark:text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                Mais de 3 botões — runtime usa apenas os 3 primeiros
              </span>
            </div>
          )}

          {buttons.slice(0, 3).map((b, idx) => {
            const titleTruncated = truncate(b.title, BUTTON_TITLE_MAX_LEN);
            // Detecta se este botão tem regra(s) de destino correspondente(s).
            // Match: phrase OU intent contém o `id` ou `title` (case-insensitive
            // em title, exato em id) — paridade com `resolveSourceHandleForTransition`.
            const matchingRules = step.transitions.filter((t) => {
              const titleLower = b.title.toLowerCase();
              const intentLower = (t.trigger_intent ?? "").toLowerCase();
              const phrasesLower = t.trigger_phrases.map((p) =>
                String(p ?? "").toLowerCase(),
              );
              const idMatchesPhrases = b.id !== "" && t.trigger_phrases.includes(b.id);
              const idMatchesIntent = b.id !== "" && t.trigger_intent === b.id;
              const titleMatchesPhrases =
                titleLower !== "" && phrasesLower.includes(titleLower);
              const titleMatchesIntent =
                titleLower !== "" && intentLower === titleLower;
              return (
                idMatchesPhrases ||
                idMatchesIntent ||
                titleMatchesPhrases ||
                titleMatchesIntent
              );
            });
            const hasRule = matchingRules.length > 0;
            // R7.4 — múltiplos destinos para o mesmo botão: indicador
            // de warning ao lado.
            const hasMultipleDestinations =
              matchingRules.length > 1 &&
              new Set(
                matchingRules.map(
                  (t) => `${t.goto_step_id ?? ""}|${t.goto_special ?? ""}`,
                ),
              ).size > 1;
            return (
              <div
                key={b.id || idx}
                className="relative flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-[11px]"
                title={b.title}
              >
                <span className="flex items-center gap-1 truncate">
                  <MessageSquare
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{titleTruncated}</span>
                </span>
                {!hasRule && (
                  <AlertTriangle
                    className="h-3 w-3 shrink-0 text-destructive"
                    aria-label={`Botão "${b.title}" sem regra de destino`}
                  />
                )}
                {hasRule && hasMultipleDestinations && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertTriangle
                          className="h-3 w-3 shrink-0 text-warning dark:text-warning"
                          aria-label={`Botão "${b.title}" tem múltiplos destinos — runtime usa o primeiro`}
                          tabIndex={0}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Múltiplos destinos para o mesmo botão. Runtime usa o
                        primeiro.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/*
                  R7.3 — handle source dedicado por botão. Posicionamento
                  vertical via `style.top` para ficar alinhado à linha do botão.
                  O id segue o contrato `btn:<button.id>` consumido pelo
                  `resolveSourceHandleForTransition` em `useDiagramData`.
                */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`btn:${b.id}`}
                  style={{
                    top:
                      BUTTON_HANDLE_OFFSET_TOP +
                      idx * BUTTON_HANDLE_SPACING,
                  }}
                  className="!h-2.5 !w-2.5 !border !border-border !bg-background"
                />
              </div>
            );
          })}
        </div>
      )}

      {/*
        R7.3 — handle source default à direita. Sempre presente, mesmo quando
        há botões: usado por transitions sem botão associado, fallback `goto`,
        e Sequencia_Por_Posicao.
      */}
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        // Posiciona logo abaixo do cabeçalho para coexistir com handles de botão
        // sem se sobrepor visualmente.
        style={{ top: DEFAULT_HANDLE_TOP }}
        className="!h-3 !w-3 !border-2 !border-primary !bg-background hover:!bg-primary"
      />
    </div>
  );
}

const FlowDiagramNode = memo(FlowDiagramNodeImpl);
FlowDiagramNode.displayName = "FlowDiagramNode";

export default FlowDiagramNode;
