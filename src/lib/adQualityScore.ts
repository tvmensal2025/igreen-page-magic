// Calcula score de qualidade do anúncio (copy + imagens) — roda no cliente, sem custo.
import { checkCopy, type PolicyHit } from "./adPolicyRules";

export interface QualityResult {
  score: number; // 0-100
  level: "red" | "yellow" | "green";
  copy: { score: number; hits: PolicyHit[]; checks: Check[] };
  image: { score: number; checks: Check[] };
  canPublish: boolean;        // só bloqueia em violação de política da Meta
  recommendedPublish: boolean; // score >= 70 — sinaliza "ideal" pra UI
  summary: string;
}
export interface Check { ok: boolean; label: string; detail?: string }

export interface CopyInput { headline: string; primary: string; description: string; cityCount: number; distribuidora?: string | null }
export interface ImageInput { width: number; height: number; dataUrl?: string; format: "square" | "vertical" | "story" }

/** Score de copy: políticas + estrutura (CTA, gancho, números, comprimento ideal). */
export function scoreCopy(input: CopyInput): QualityResult["copy"] {
  const all = `${input.headline}\n${input.primary}\n${input.description}`;
  const hits = [...checkCopy(input.headline), ...checkCopy(input.primary), ...checkCopy(input.description)];

  const checks: Check[] = [];
  // 1. Comprimento ideal
  const hLen = input.headline.length;
  checks.push({ ok: hLen >= 12 && hLen <= 30, label: `Título ${hLen} caracteres`, detail: hLen < 12 ? "muito curto" : hLen > 30 ? "passou de 30" : "ideal: 12-30" });
  const pLen = input.primary.length;
  checks.push({ ok: pLen >= 30 && pLen <= 90, label: `Texto principal ${pLen} caracteres`, detail: "ideal: 30-90" });
  // 2. CTA presente
  const ctaRegex = /\b(fala|toca|garante|peça|peca|simule|baixe|conhe[çc]a|descubra|economiz|chame)\b|👇|👉/i;
  checks.push({ ok: ctaRegex.test(input.primary), label: "Tem chamada pra ação", detail: "ex: 'fala no zap', 'garante a sua' 👇" });
  // 3. Número/% (números aumentam CTR)
  checks.push({ ok: /\d/.test(all), label: "Tem número específico", detail: "ex: '20% mais barata', 'R$ 48/mês'" });
  // 4. Personalização (cidade ou distribuidora)
  const personalized = !!input.distribuidora || input.cityCount === 1;
  checks.push({ ok: personalized || /cliente|cidade|região|aqui/i.test(all), label: "Tem personalização local", detail: "menciona distribuidora ou região" });
  // 5. Sem políticas
  checks.push({ ok: hits.filter(h => h.severity === "block").length === 0, label: "Sem termos proibidos pela Meta", detail: hits.filter(h => h.severity === "block").map(h => h.message).join("; ") || undefined });

  const passed = checks.filter(c => c.ok).length;
  const base = (passed / checks.length) * 100;
  // Penaliza warns/blocks adicionais
  const blocks = hits.filter(h => h.severity === "block").length;
  const warns = hits.filter(h => h.severity === "warn").length;
  const score = Math.max(0, Math.round(base - blocks * 25 - warns * 8));
  return { score, hits, checks };
}

/** Score de imagem usando análise rápida no canvas. */
export async function scoreImage(input: ImageInput): Promise<QualityResult["image"]> {
  const checks: Check[] = [];
  // 1. Dimensão correta
  const expected = input.format === "square" ? { w: 1080, h: 1080 } : input.format === "vertical" ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
  const dimOk = input.width >= expected.w && input.height >= expected.h;
  const dimBonus = input.width >= expected.w * 1.5 && input.height >= expected.h * 1.5;
  checks.push({ ok: dimOk, label: `Dimensão ${input.width}×${input.height}${dimBonus ? " (alta resolução)" : ""}`, detail: `mínimo ${expected.w}×${expected.h}` });

  let textRatio = 0;
  let avgBrightness = 128;
  let contrast = 0;

  if (input.dataUrl) {
    try {
      const img = await loadImg(input.dataUrl);
      const c = document.createElement("canvas");
      const W = 200; const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;
      // brilho médio + variância (proxy de contraste)
      let sum = 0, sumSq = 0;
      const lum = new Float32Array(W * H);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lum[j] = l; sum += l; sumSq += l * l;
      }
      avgBrightness = sum / lum.length;
      contrast = Math.sqrt(sumSq / lum.length - avgBrightness * avgBrightness);
      // detecção de "texto" via densidade de bordas (Sobel simplificado horizontal+vertical)
      let edges = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const gx = Math.abs(lum[i + 1] - lum[i - 1]);
          const gy = Math.abs(lum[i + W] - lum[i - W]);
          if (gx + gy > 80) edges++;
        }
      }
      textRatio = edges / (W * H);
    } catch {/* ignore */}
  }

  checks.push({ ok: avgBrightness >= 60 && avgBrightness <= 200, label: "Brilho equilibrado", detail: avgBrightness < 60 ? "muito escura" : avgBrightness > 200 ? "muito clara/estourada" : "boa exposição" });
  checks.push({ ok: contrast >= 25, label: "Contraste suficiente", detail: contrast < 25 ? "imagem chapada — pouco impacto visual" : "boa profundidade" });
  checks.push({ ok: textRatio < 0.28, label: "Pouco texto na imagem", detail: textRatio >= 0.28 ? `~${Math.round(textRatio * 100)}% de bordas (texto > 28% reduz alcance)` : "Meta favorece imagens com pouco texto" });

  const passed = checks.filter(c => c.ok).length;
  let score = Math.round((passed / checks.length) * 100);
  if (dimBonus) score = Math.min(100, score + 10);
  return { score, checks };
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });
}

export function aggregate(copy: QualityResult["copy"], image: QualityResult["image"]): QualityResult {
  const score = Math.round(copy.score * 0.6 + image.score * 0.4);
  const level: QualityResult["level"] = score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
  const blocks = copy.hits.filter(h => h.severity === "block").length;
  // Threshold 70: scores menores costumam ter CPL alto e/ou risco de rejeição.
  const canPublish = blocks === 0 && score >= 70;
  const summary = level === "green" ? "Pronto pra performar" : level === "yellow" ? "Funciona, mas dá pra melhorar" : "Risco de rejeição ou CPL alto";
  return { score, level, copy, image, canPublish, summary };
}