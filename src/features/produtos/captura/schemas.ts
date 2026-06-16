// =============================================================================
// Captura por família de produto — Schemas Zod
// =============================================================================
// Validação dos dados de captura específicos de cada família. O resultado
// (após parse) é gravado em sales.capture_data. Energia não tem schema aqui:
// reaproveita o pipeline de OCR/portal/OTP já existente (customers.*).
// =============================================================================

import { z } from "zod";

// ─── Telecom ──────────────────────────────────────────────────────────────
export const telecomCaptureSchema = z.object({
  plano: z.string().min(1, "Selecione um plano"),
  portabilidade: z.boolean().default(false),
  // Número só é exigido quando há portabilidade.
  numero: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  tipo_chip: z.enum(["fisico", "esim"], {
    required_error: "Selecione o tipo de chip",
  }),
}).refine(
  (data) => !data.portabilidade || !!(data.numero && data.numero.replace(/\D/g, "").length >= 10),
  { message: "Informe o número para portabilidade", path: ["numero"] },
);

export type TelecomCaptureInput = z.infer<typeof telecomCaptureSchema>;

// ─── Seguros ────────────────────────────────────────────────────────────────
export const segurosCaptureSchema = z.object({
  placa: z
    .string()
    .trim()
    .min(7, "Placa inválida")
    .max(8, "Placa inválida"),
  modelo: z.string().trim().min(2, "Informe o modelo do veículo"),
  ano: z
    .number({ invalid_type_error: "Informe o ano" })
    .int()
    .min(1950, "Ano inválido")
    .max(new Date().getFullYear() + 1, "Ano inválido"),
  plano: z.enum(["basic", "premium", "infinite"], {
    required_error: "Selecione um plano",
  }),
});

export type SegurosCaptureInput = z.infer<typeof segurosCaptureSchema>;

// ─── Placas ───────────────────────────────────────────────────────────────
export const placasCaptureSchema = z.object({
  consumo_kwh: z
    .number({ invalid_type_error: "Informe o consumo médio" })
    .positive("Consumo deve ser maior que zero"),
  tipo_imovel: z.enum(["residencial", "comercial", "industrial", "rural"], {
    required_error: "Selecione o tipo de imóvel",
  }),
  financiamento: z.boolean().default(false),
});

export type PlacasCaptureInput = z.infer<typeof placasCaptureSchema>;

// ─── Mapa família → schema (para captura genérica) ──────────────────────────
import type { ProductFamily } from "../catalogo/types";

export const CAPTURE_SCHEMA_BY_FAMILY: Partial<Record<ProductFamily, z.ZodTypeAny>> = {
  telecom: telecomCaptureSchema,
  seguros: segurosCaptureSchema,
  placas: placasCaptureSchema,
};

/** Indica se a família usa formulário de captura próprio (vs. pipeline de energia). */
export function hasCaptureForm(family: ProductFamily): boolean {
  return family in CAPTURE_SCHEMA_BY_FAMILY;
}

// ─── Validação leve de captura por família (Requisito 7.2) ──────────────────
// Usada no ponto de entrada de venda manual (RegistrarVendaDialog) como guarda
// antes de salvar. É propositalmente leve: só valida quando a família tem
// schema E quando há dados de captura para validar. Famílias sem schema
// (energia/club/expansao) ou captura vazia passam direto (ok), porque a
// captura dessas famílias acontece por outro fluxo (OCR/portal/WhatsApp).

/** Resultado da validação de captura. Em caso de erro (`ok: false`), traz uma
 * mensagem amigável em pt-BR (juntando as mensagens dos campos inválidos). */
export interface CaptureValidationResult {
  ok: boolean;
  /** Dados normalizados pelo Zod quando a validação passa. */
  data?: unknown;
  /** Mensagem de erro amigável (pt-BR) quando a validação falha. */
  message?: string;
}

/** Considera "vazio" quando não há nenhum campo preenchido. Evita bloquear o
 * fluxo manual atual, que não coleta captura por família. */
function isEmptyCapture(captureData: unknown): boolean {
  if (captureData == null) return true;
  if (typeof captureData !== "object") return false;
  return Object.keys(captureData as Record<string, unknown>).length === 0;
}

/**
 * Valida `capture_data` contra o schema Zod da família, quando aplicável.
 *
 * - Família sem schema (energia/club/expansao) → ok (sem captura própria).
 * - Captura vazia/ausente → ok (nada a validar; venda manual pode não capturar).
 * - Caso contrário → roda o schema Zod e devolve os dados já normalizados ou
 *   uma mensagem de erro amigável em pt-BR.
 */
export function validateCaptureForFamily(
  family: ProductFamily,
  captureData: unknown,
): CaptureValidationResult {
  const schema = CAPTURE_SCHEMA_BY_FAMILY[family];
  if (!schema) return { ok: true, data: captureData };
  if (isEmptyCapture(captureData)) return { ok: true, data: captureData };

  const result = schema.safeParse(captureData);
  if (result.success) return { ok: true, data: result.data };

  // Junta as mensagens de cada campo inválido numa frase única em pt-BR.
  const message = result.error.issues
    .map((issue) => issue.message)
    .filter((m, i, arr) => arr.indexOf(m) === i) // remove duplicadas
    .join(" · ");

  return {
    ok: false,
    message: message || "Dados de captura inválidos para esta família.",
  };
}
