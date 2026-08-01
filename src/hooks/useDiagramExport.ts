// useDiagramExport — hook responsável pela exportação do Modo_Diagrama em
// PNG/SVG via `html-to-image`, conforme Task 9.3 do spec `flow-diagram-view`.
//
// Fluxo (alinhado ao design "Hook 5: useDiagramExport" e ao Requirement 16):
//   1. Calcula a bounding box dos nodes via `getNodesBounds(reactFlowInstance.getNodes())`.
//   2. Calcula um viewport sintético via `getViewportForBounds(bounds, w, h, 0.5, 2, 20)`
//      — minZoom=0.5, maxZoom=2, padding=20px (R16.3).
//   3. Localiza o elemento `.react-flow__viewport` dentro do container do
//      ReactFlow renderizado (`.react-flow`) e aplica a transformação calculada
//      via `style.transform`, garantindo que a imagem capturada enquadre todo
//      o conteúdo (independente do que estava visível na tela do consultor).
//   4. Chama `toPng` ou `toSvg`. Para PNG usamos `pixelRatio: 2` (R16.3).
//   5. Dispara o download via âncora invisível (`<a download="...">`).
//   6. Toda a operação está envolvida em `Promise.race` com timeout de 10s
//      (R16.7); em qualquer falha exibe o `toast.error` exigido pelo spec.
//   7. O estado `exporting` é `true` enquanto a operação está em andamento e
//      bloqueia novas tentativas (R16.8).
//
// Mapeia para os requisitos R16.3, R16.4, R16.5, R16.6, R16.7 e R16.8.
// O hook não realiza upload nem gera links públicos — download local apenas
// (R16.6 já é garantido pelo uso de `<a download>` no próprio navegador).

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng, toSvg } from "html-to-image";
import {
  getNodesBounds,
  getViewportForBounds,
  type ReactFlowInstance,
} from "@xyflow/react";
import { toast } from "@/components/ui/sonner";

import { Variant } from "@/components/admin/flow-builder/flowTypes";

// Dimensões-alvo do canvas exportado. Aproximam um desktop padrão (R16.3 e
// R16.4 não fixam um tamanho mínimo, mas o uso típico é compartilhar imagem
// nítida em tela cheia ou em documentos).
const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
// Padding em pixels mínimo na imagem final (R16.3 e R16.4).
const VIEWPORT_PADDING = 20;
// Limites de zoom usados pelo `getViewportForBounds` (alinhados ao
// `minZoom=0.25` / `maxZoom=2` do canvas mas aqui usamos 0.5 como mínimo
// para evitar imagens muito reduzidas, conforme exemplo do design).
const VIEWPORT_MIN_ZOOM = 0.5;
const VIEWPORT_MAX_ZOOM = 2;
// Timeout de 10 segundos (R16.7).
const EXPORT_TIMEOUT_MS = 10_000;
// Background branco para garantir contraste e compatibilidade com fundos
// claros/escuros do consumidor da imagem.
const EXPORT_BACKGROUND = "#ffffff";

export interface UseDiagramExportArgs {
  /** Slug URL-safe do Consultor (ver Glossário do spec). */
  consultantSlug: string;
  /** Variante atualmente em edição. Vai no nome do arquivo (R16.3, R16.4). */
  variant: Variant;
  /**
   * Instância do React Flow obtida via `useReactFlow()` ou `onInit`. Pode ser
   * `null` enquanto o canvas ainda não montou; nesse caso o hook degrada de
   * forma silenciosa (toast informativo), mas nunca explode.
   */
  reactFlowInstance: ReactFlowInstance | null;
}

export interface UseDiagramExportResult {
  /** Exporta o canvas atual como PNG. */
  exportPng: () => Promise<void>;
  /** Exporta o canvas atual como SVG. */
  exportSvg: () => Promise<void>;
  /** `true` enquanto uma exportação está em andamento (R16.8). */
  exporting: boolean;
}

/** Formata `YYYYMMDD` em UTC a partir do `Date` recebido (default = `now`). */
function formatYyyymmdd(date: Date = new Date()): string {
  // `toISOString()` sempre devolve `YYYY-MM-DDTHH:mm:ss.sssZ`; cortamos os 10
  // primeiros chars e removemos os hífens. UTC é suficiente para o nome de
  // arquivo (não é informação sensível à timezone do consultor).
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Constrói o nome de arquivo no formato `fluxo-{slug}-variante-{variant}-{YYYYMMDD}.{ext}`. */
function buildFilename(
  consultantSlug: string,
  variant: Variant,
  ext: "png" | "svg",
  date: Date = new Date(),
): string {
  // Defesa: quando `consultantSlug` é vazio (ex: queries iniciais, fallback
  // do glossário ainda não computado), usamos "fluxo" como nome neutro para
  // evitar gerar arquivos como `fluxo--variante-A-...`.
  const safeSlug = consultantSlug.trim() || "fluxo";
  return `fluxo-${safeSlug}-variante-${variant}-${formatYyyymmdd(date)}.${ext}`;
}

/** Cria um `<a>` invisível, dispara o download e remove o elemento. */
function triggerDownload(dataUrl: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.setAttribute("href", dataUrl);
  a.setAttribute("download", filename);
  // Anexar ao body é necessário para Firefox respeitar o `click()` programático.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Promise que rejeita após `ms` ms — usada via `Promise.race` para o timeout.
 *
 * Recebe um `setHandle` callback para que o consumidor possa registrar o
 * `setTimeout` em uma ref e cancelá-lo no unmount, evitando late-rejections
 * em testes (`act()` warnings) e em remount rápido durante hot-reload. O
 * timer é limpo automaticamente no `finally` do `runExport` — esse callback
 * só importa quando o componente desmonta antes da exportação completar.
 */
function timeoutAfter(
  ms: number,
  label: string,
  setHandle?: (h: ReturnType<typeof setTimeout>) => void,
): Promise<never> {
  return new Promise((_, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(`Export timed out after ${ms}ms (${label})`));
    }, ms);
    setHandle?.(handle);
  });
}

/**
 * Localiza o elemento `.react-flow__viewport` no DOM. O React Flow renderiza
 * apenas um por instância; quando há mais de um canvas montado (ex: testes),
 * preferimos o primeiro descendente do container `.react-flow` mais próximo.
 */
function findViewportElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  return el ?? null;
}

export function useDiagramExport({
  consultantSlug,
  variant,
  reactFlowInstance,
}: UseDiagramExportArgs): UseDiagramExportResult {
  const [exporting, setExporting] = useState(false);
  // Guarda a referência síncrona para evitar disparos concorrentes mesmo
  // antes do `setExporting` ter sido aplicado pelo React (R16.8).
  const inFlightRef = useRef(false);
  // Handle do timeout em voo — limpamos no unmount para evitar late
  // rejections após o componente sair da árvore.
  const timeoutHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (timeoutHandleRef.current) {
        clearTimeout(timeoutHandleRef.current);
        timeoutHandleRef.current = null;
      }
    };
  }, []);

  const runExport = useCallback(
    async (format: "png" | "svg"): Promise<void> => {
      if (inFlightRef.current) return;
      if (!reactFlowInstance) {
        toast.error("Não foi possível exportar o diagrama. Tente novamente.");
        return;
      }

      const nodes = reactFlowInstance.getNodes();
      if (!nodes || nodes.length === 0) {
        // Defensivo: a toolbar já desabilita o botão (R16.2), mas se o hook
        // for chamado mesmo assim avisamos sem ruído.
        toast.error("Não foi possível exportar o diagrama. Tente novamente.");
        return;
      }

      const viewportEl = findViewportElement();
      if (!viewportEl) {
        toast.error("Não foi possível exportar o diagrama. Tente novamente.");
        return;
      }

      inFlightRef.current = true;
      setExporting(true);

      try {
        const bounds = getNodesBounds(nodes);
        const viewport = getViewportForBounds(
          bounds,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          VIEWPORT_MIN_ZOOM,
          VIEWPORT_MAX_ZOOM,
          VIEWPORT_PADDING,
        );

        // O `style.transform` calculado é aplicado ao elemento que
        // `html-to-image` vai serializar — isto reposiciona o conteúdo para
        // dentro da área `width × height` enquadrando todos os nodes.
        const transformStyle = {
          width: `${EXPORT_WIDTH}px`,
          height: `${EXPORT_HEIGHT}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        };

        const exportPromise: Promise<string> =
          format === "png"
            ? toPng(viewportEl, {
                backgroundColor: EXPORT_BACKGROUND,
                pixelRatio: 2,
                width: EXPORT_WIDTH,
                height: EXPORT_HEIGHT,
                style: transformStyle,
              })
            : toSvg(viewportEl, {
                backgroundColor: EXPORT_BACKGROUND,
                width: EXPORT_WIDTH,
                height: EXPORT_HEIGHT,
                style: transformStyle,
              });

        const dataUrl = await Promise.race([
          exportPromise,
          timeoutAfter(EXPORT_TIMEOUT_MS, format, (h) => {
            timeoutHandleRef.current = h;
          }),
        ]);

        const filename = buildFilename(consultantSlug, variant, format);
        triggerDownload(dataUrl, filename);
      } catch (err) {
        // R16.7: qualquer falha (incluindo timeout) exibe a mesma mensagem
        // padronizada em pt-BR exigida pelo spec.
        if (typeof console !== "undefined") {
          console.error("[useDiagramExport] export failed", { format, err });
        }
        toast.error("Não foi possível exportar o diagrama. Tente novamente.");
      } finally {
        // Limpa o timeout pendente em todos os caminhos (sucesso ou erro):
        // após o `Promise.race` resolver, o timer "perdedor" precisa ser
        // cancelado para não rejeitar tardiamente.
        if (timeoutHandleRef.current) {
          clearTimeout(timeoutHandleRef.current);
          timeoutHandleRef.current = null;
        }
        inFlightRef.current = false;
        if (!unmountedRef.current) setExporting(false);
      }
    },
    [consultantSlug, variant, reactFlowInstance],
  );

  const exportPng = useCallback(() => runExport("png"), [runExport]);
  const exportSvg = useCallback(() => runExport("svg"), [runExport]);

  return { exportPng, exportSvg, exporting };
}

export default useDiagramExport;
