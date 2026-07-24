---
inclusion: auto
name: minio-storage
description: Upload MinIO SigV4 e fallback Storage. Use ao mexer em mídia.
---

# MinIO — storage de mídia

Fonte: #[[file:docs/auditoria/06-integracoes.md]] · helper: #[[file:supabase/functions/_shared/minio-upload.ts]]

## Peças
| Peça | Uso |
|---|---|
| `upload-media` | Chat/template/avatar — MinIO 1º |
| `upload-documents-minio` | Conta/doc → `documentos/…` |
| `migrate-supabase-to-minio` | Storage → MinIO (idempotente) |
| `minio-quota-check` | Cron health/uso |
| `_shared/media-storage.ts` | MinIO timeout → fallback Storage |
| `src/services/minioUpload.ts` | SPA → `upload-media` |

## Primário vs fallback
- **Primário:** MinIO S3 SigV4 (`MINIO_BUCKET` default `igreen`)
- **Fallback:** Supabase Storage bucket `whatsapp-media` (**público** via `getPublicUrl` em `_shared/media-storage.ts`)
- Ainda Storage direto em alguns paths: `consultant-photos` (Ads)
- Webhook/OCR: **não** gravar data-URL base64 no banco
- Não assumir que todo Storage do projeto é privado — este fallback WA é público de propósito

## Prefixos
`documentos/{consultor}/{cliente}/`, `whatsapp/`, `templates/`, `consultores/`, `public/`, `private/`

## Secrets (só edge)
`MINIO_SERVER_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`
