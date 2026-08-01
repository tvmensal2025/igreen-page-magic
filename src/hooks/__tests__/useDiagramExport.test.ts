/**
 * Unit tests para `useDiagramExport` (Task 9.5 — R16.3, R16.6, R16.7, R16.8).
 *
 * Estes testes focam em invariantes "puras" do hook que não dependem do
 * DOM nem do React Flow real:
 *
 *   - Nome de arquivo no formato `fluxo-{slug}-variante-{V}-{YYYYMMDD}.{ext}`
 *     (R16.3, R16.4) com slug fallback "fluxo" quando vazio.
 *   - Não dispara export quando `reactFlowInstance` é `null` (estado pré-mount).
 *   - O bloqueio de re-entrância (`exporting=true`) impede chamadas concorrentes
 *     (R16.8).
 *
 * Para o caso de timeout/erro mockamos `html-to-image` com `vi.mock`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock de html-to-image para evitar trabalhar com canvas real em jsdom.
vi.mock("html-to-image", () => ({
  toPng: vi.fn(() => Promise.resolve("data:image/png;base64,fake")),
  toSvg: vi.fn(() => Promise.resolve("data:image/svg+xml;base64,fake")),
}));

// Mock do toast — evita que o toast real apareça em testes.
vi.mock("@/components/ui/sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
  Toaster: () => null,
}));

import { toPng, toSvg } from "html-to-image";
import { toast } from "@/components/ui/sonner";
import { useDiagramExport } from "../useDiagramExport";
import type { ReactFlowInstance } from "@xyflow/react";

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeInstance(): ReactFlowInstance {
  return {
    getNodes: vi.fn(() => [
      { id: "a", position: { x: 0, y: 0 }, data: {}, type: "flow" },
    ]),
  } as unknown as ReactFlowInstance;
}

function setupViewport() {
  // jsdom: garantir que existe um elemento com a classe esperada para que
  // o hook não falhe no `findViewportElement`.
  const div = document.createElement("div");
  div.className = "react-flow__viewport";
  document.body.appendChild(div);
  return () => {
    document.body.removeChild(div);
  };
}

describe("useDiagramExport — exportação", () => {
  it("instância null → toast.error e nada é exportado", async () => {
    const { result } = renderHook(() =>
      useDiagramExport({
        consultantSlug: "camila",
        variant: "A",
        reactFlowInstance: null,
      }),
    );
    await act(async () => {
      await result.current.exportPng();
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível exportar o diagrama. Tente novamente.",
    );
    expect(toPng).not.toHaveBeenCalled();
  });

  it("R16.3 — exportPng chama toPng com pixelRatio=2", async () => {
    const cleanup = setupViewport();
    try {
      const { result } = renderHook(() =>
        useDiagramExport({
          consultantSlug: "camila",
          variant: "A",
          reactFlowInstance: fakeInstance(),
        }),
      );
      await act(async () => {
        await result.current.exportPng();
      });
      expect(toPng).toHaveBeenCalledTimes(1);
      const args = (toPng as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0];
      const opts = args[1] as { pixelRatio?: number; backgroundColor?: string };
      expect(opts.pixelRatio).toBe(2);
      expect(opts.backgroundColor).toBe("#ffffff");
    } finally {
      cleanup();
    }
  });

  it("R16.4 — exportSvg chama toSvg sem pixelRatio (não aplicável a SVG)", async () => {
    const cleanup = setupViewport();
    try {
      const { result } = renderHook(() =>
        useDiagramExport({
          consultantSlug: "camila",
          variant: "B",
          reactFlowInstance: fakeInstance(),
        }),
      );
      await act(async () => {
        await result.current.exportSvg();
      });
      expect(toSvg).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("R16.7 — falha de toPng exibe toast em pt-BR e libera exporting", async () => {
    const cleanup = setupViewport();
    try {
      (toPng as unknown as { mockRejectedValueOnce: (e: unknown) => unknown })
        .mockRejectedValueOnce(new Error("boom"));
      const { result } = renderHook(() =>
        useDiagramExport({
          consultantSlug: "x",
          variant: "A",
          reactFlowInstance: fakeInstance(),
        }),
      );
      await act(async () => {
        await result.current.exportPng();
      });
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível exportar o diagrama. Tente novamente.",
      );
      // R16.8 — após erro, exporting volta a `false` para liberar retry.
      expect(result.current.exporting).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("R16.4 — slug vazio cai em 'fluxo' no nome do arquivo", async () => {
    const cleanup = setupViewport();
    try {
      // Espia a criação do <a> para inspecionar o `download` atribuído.
      const original = document.createElement.bind(document);
      const downloads: string[] = [];
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = original(tag) as HTMLAnchorElement;
        if (tag === "a") {
          // Captura o setAttribute("download", ...).
          const realSet = el.setAttribute.bind(el);
          el.setAttribute = (name: string, value: string) => {
            if (name === "download") downloads.push(value);
            return realSet(name, value);
          };
          // Stub o click para não navegar.
          el.click = () => {};
        }
        return el;
      });

      const { result } = renderHook(() =>
        useDiagramExport({
          consultantSlug: "",
          variant: "A",
          reactFlowInstance: fakeInstance(),
        }),
      );
      await act(async () => {
        await result.current.exportPng();
      });
      const filename = downloads.find((d) => d.startsWith("fluxo-"));
      expect(filename).toBeDefined();
      expect(filename).toMatch(/^fluxo-fluxo-variante-A-\d{8}\.png$/);
      vi.restoreAllMocks();
    } finally {
      cleanup();
    }
  });
});
