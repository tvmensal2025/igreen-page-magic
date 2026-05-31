-- Adiciona campo para armazenar base64 do VERSO do documento (RG).
-- Espelha document_front_base64: garante que o verso esteja sempre disponível
-- para envio ao Portal 2 mesmo quando o MinIO está indisponível e a URL não
-- persiste (fallback inline). CNH não usa verso (gravado como "nao_aplicavel").
ALTER TABLE customers ADD COLUMN IF NOT EXISTS document_back_base64 TEXT;

COMMENT ON COLUMN customers.document_back_base64 IS 'Base64 do verso do documento (temporário para OCR/envio ao portal)';
