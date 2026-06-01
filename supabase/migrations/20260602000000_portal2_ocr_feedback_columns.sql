-- Portal 2 — OCR Feedback Loop: novas colunas de extração, classificação de erro e correção
--
-- Feature: portal2-ocr-feedback-loop (Req 11)
--
-- Adiciona em customers:
--   1. portal2_celular_alt        → celular alternativo p/ o Portal 2 (≠ phone_whatsapp)
--   2. portal2_ocr_doc_result     → resultado sanitizado da extração do documento
--   3. portal2_ocr_bill_result    → resultado sanitizado da extração da conta
--   4. portal2_extraction_mode    → modo do cadastro: 'auto' | 'manual' | NULL
--   5. portal2_error_kind         → Classe_de_Erro da última rejeição do Portal 2
--   6. portal2_correction_attempts→ contador de Tentativas_por_Classe {kind: int}, default {}
--
-- Não-destrutiva: apenas ADD COLUMN IF NOT EXISTS (colunas anuláveis ou com default).
-- NÃO remove, renomeia ou altera o tipo de colunas existentes.
-- Preserva a unicidade de phone_whatsapp e NÃO cria unicidade em portal2_celular_alt.
--
-- Idempotente: rodar várias vezes não quebra.
--
-- ATENÇÃO (Req 11.5): a aplicação desta migração no banco de produção exige
-- aprovação humana explícita registrada. Este arquivo apenas declara o DDL.

-- 1) Novas colunas (todas anuláveis ou com default; preservam as linhas existentes — Req 11.1, 11.2, 11.6)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal2_celular_alt text,
  ADD COLUMN IF NOT EXISTS portal2_ocr_doc_result jsonb,
  ADD COLUMN IF NOT EXISTS portal2_ocr_bill_result jsonb,
  ADD COLUMN IF NOT EXISTS portal2_extraction_mode text,
  ADD COLUMN IF NOT EXISTS portal2_error_kind text,
  ADD COLUMN IF NOT EXISTS portal2_correction_attempts jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN customers.portal2_celular_alt IS
  'Celular alternativo enviado ao Portal 2 quando o telefone original é duplicado. Separado de phone_whatsapp (nunca o sobrescreve).';
COMMENT ON COLUMN customers.portal2_ocr_doc_result IS
  'Resultado sanitizado (PII mascarada) da extração do documento pela IA do Portal 2.';
COMMENT ON COLUMN customers.portal2_ocr_bill_result IS
  'Resultado sanitizado (PII mascarada) da extração da conta de energia pela IA do Portal 2.';
COMMENT ON COLUMN customers.portal2_extraction_mode IS
  'Modo da extração do cadastro: auto (IA do portal leu tudo) | manual (caiu no preenchimento manual) | NULL (não determinado).';
COMMENT ON COLUMN customers.portal2_error_kind IS
  'Classe_de_Erro estável da última rejeição do Portal 2 (ex.: duplicate_phone, duplicate_email, duplicate_installation, missing_consumo, duplicate_document, no_coverage, unknown).';
COMMENT ON COLUMN customers.portal2_correction_attempts IS
  'Contador de Tentativas_por_Classe por cadastro: mapa jsonb {error_kind: int} (inteiros não-negativos), default {}. Usado para impor o limite que evita loop infinito.';

-- 2) Restrição de valores do modo de extração (aceita apenas auto/manual/NULL — Req 11.3)
-- DROP/ADD para ser idempotente.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_portal2_extraction_mode_chk;
ALTER TABLE customers ADD CONSTRAINT customers_portal2_extraction_mode_chk
  CHECK (portal2_extraction_mode IS NULL OR portal2_extraction_mode IN ('auto', 'manual'));

-- 3) Índice parcial para consultas por Classe_de_Erro (cadastros que precisam de atenção)
CREATE INDEX IF NOT EXISTS customers_portal2_error_kind_idx
  ON customers (portal2_error_kind)
  WHERE portal2_error_kind IS NOT NULL;
