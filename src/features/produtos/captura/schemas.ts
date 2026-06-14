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
