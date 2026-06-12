/**
 * wizardHelpers — constantes, tipos e utilitários puros do wizard de campanha.
 * Tudo aqui foi extraído (sem mudar comportamento) do CreateCampaignWizard.tsx
 * legado, para manter os componentes visuais enxutos e reaproveitar a lógica.
 */
import type { AdFormat } from "../AdPreview";

export type { AdFormat };

// Especificação de cada formato de anúncio (dimensão exigida pela Meta).
export const FORMAT_SPEC: Record<AdFormat, { label: string; w: number; h: number; ratio: number; desc: string }> = {
  square:   { label: "Feed quadrado",   w: 1080, h: 1080, ratio: 1.0,    desc: "1080×1080 — Feed Facebook + Instagram" },
  vertical: { label: "Feed vertical",   w: 1080, h: 1350, ratio: 0.8,    desc: "1080×1350 — recomendado p/ mobile" },
  story:    { label: "Stories / Reels", w: 1080, h: 1920, ratio: 0.5625, desc: "1080×1920 — Stories e Reels" },
};

export const PER_FORMAT_LIMIT = 4;
export const COPY_LIMITS = { headline: 30, primary: 90, description: 25 } as const;
export const INITIAL_MSG_LIMIT = 160;

// Posicionamentos disponíveis (modo manual). "auto" usa Advantage+.
export const ALL_PLACEMENTS = [
  "fb:feed", "fb:marketplace", "fb:video_feeds", "fb:story", "fb:facebook_reels", "fb:search", "fb:instream_video",
  "ig:stream", "ig:story", "ig:reels", "ig:explore",
];

// Grupos de placements para o modo manual (Step 4).
export const PLACEMENT_GROUPS = [
  { label: "Feed & Descoberta", items: [["fb:feed", "Facebook Feed"], ["ig:stream", "Instagram Feed"], ["fb:marketplace", "Marketplace"], ["ig:explore", "Explore"]] },
  { label: "Stories", items: [["fb:story", "Facebook Stories"], ["ig:story", "Instagram Stories"]] },
  { label: "Reels", items: [["fb:facebook_reels", "Facebook Reels"], ["ig:reels", "Instagram Reels"]] },
  { label: "Vídeo", items: [["fb:video_feeds", "Facebook Video Feeds"], ["fb:instream_video", "In-stream Video"]] },
  { label: "Busca", items: [["fb:search", "Facebook Search"]] },
] as const;

export interface AdFile { file: File; url: string; w: number; h: number }
export type FilesByFormat = Record<AdFormat, AdFile[]>;
export const EMPTY_FILES: FilesByFormat = { square: [], vertical: [], story: [] };

// Primeira mensagem padrão do WhatsApp (CTWA), conforme a distribuidora.
export function buildDefaultInitialMessage(distrib: string | null): string {
  return distrib
    ? `Olá! Quero saber mais sobre a redução na conta de luz ${distrib}.`
    : "Olá! Quero saber mais sobre a redução na minha conta de luz.";
}

// Mapa nome do estado (retornado pela Meta) -> UF, p/ checar cidade fora da concessão.
export const UF_MAP: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapá: "AP", amazonas: "AM", bahia: "BA", ceará: "CE",
  "distrito federal": "DF", "espírito santo": "ES", goiás: "GO", maranhão: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", pará: "PA",
  paraíba: "PB", paraná: "PR", pernambuco: "PE", piauí: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondônia: "RO", roraima: "RR",
  "santa catarina": "SC", "são paulo": "SP", sergipe: "SE", tocantins: "TO",
};

export function readImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("Imagem inválida")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function cropToFormat(file: File, spec: { w: number; h: number }): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = spec.w; canvas.height = spec.h;
      const ctx = canvas.getContext("2d")!;
      const sRatio = img.naturalWidth / img.naturalHeight;
      const dRatio = spec.w / spec.h;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (sRatio > dRatio) { sw = img.naturalHeight * dRatio; sx = (img.naturalWidth - sw) / 2; }
      else { sh = img.naturalWidth / dRatio; sy = (img.naturalHeight - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, spec.w, spec.h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) return reject(new Error("Falha no recorte"));
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + "-cropped.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem inválida")); };
    img.src = url;
  });
}

// Validação de proporção/dimensão da imagem por formato.
export function isFileValidFor(a: AdFile, fmt: AdFormat): boolean {
  const spec = FORMAT_SPEC[fmt];
  if (a.w < spec.w || a.h < spec.h) return false;
  const ratio = a.w / a.h;
  return Math.abs(ratio - spec.ratio) / spec.ratio <= 0.02;
}
export function isFileValidAny(a: AdFile): boolean {
  return (Object.keys(FORMAT_SPEC) as AdFormat[]).some((f) => isFileValidFor(a, f));
}
