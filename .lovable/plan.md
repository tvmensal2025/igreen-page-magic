# Auditoria: O que muda na infraestrutura externa após o Remix

O Remix criou um **novo projeto Lovable** (ID `3b3d0c8b-af52-4ad1-a44c-d389fb0bd4b2`) mas **continua apontando para o mesmo Supabase de produção** (`zlzasfhcxcznaprrragl`). Isso define o que precisa ou não mudar em cada serviço externo.

---

## 1. Supabase ✅ Nada muda

Mesmo project ref, mesmas Edge Functions, mesmos 49 segredos, mesmos crons. O Remix herdou tudo automaticamente.
**Ação:** apenas confirmar que `TWOCAPTCHA_API_KEY` e `ELEVENLABS_API_KEY` foram atualizados (você já fez).

---

## 2. GitHub ⚠️ Precisa decidir

O Remix gera um **novo repositório separado** quando você conectar ao GitHub. O repo original (`tvmensal2025/viana-replica-vault`) continua existindo apontando para o projeto antigo.

**Cenários:**

- **Se este Remix é só um espelho de leitura/teste** → não conectar GitHub, deixar como está.
- **Se vai virar o projeto oficial** → conectar a um novo repo (ex: `igreen-cloud-v2`) e arquivar o antigo. Os workflows `.github/workflows/deploy-edge-functions.yml` continuarão funcionando porque apontam para o mesmo Supabase ref.

---

## 3. MinIO ✅ Nada muda

Bucket `igreen` no `igreen-minio.d9v63q.easypanel.host` é acessado via Edge Functions usando `MINIO_*` secrets no Supabase. Como o Supabase é o mesmo, **continua funcionando sem alteração**.
**Ação:** zero.

---

## 4. Easypanel ⚠️ Verificar 3 workers

Os containers em Easypanel chamam as Edge Functions via webhook. Como o Supabase é o mesmo:


| Worker                                 | URL/Endpoint                     | Muda? |
| -------------------------------------- | -------------------------------- | ----- |
| `worker-portal-2` (cadastro iGreen)    | `PORTAL2_WORKER_URL` no Supabase | ❌ não |
| `compress-worker` (vídeo/ffmpeg)       | chamado pelas funções            | ❌ não |
| `worker-igreen-sync` (extensão Chrome) | bridge local                     | ❌ não |
| `igreen-evolution-api` (WhatsApp)      | `EVOLUTION_API_URL`              | ❌ não |
| `igreen-minio`                         | `MINIO_SERVER_URL`               | ❌ não |


**Ação:** apenas verificar se todos estão **online** no Easypanel (especialmente Evolution da Olímpia que estava com lock).

---

## 5. Domínio `igreen.cloud` 🔴 Precisa republicar

O domínio customizado está vinculado ao **projeto Lovable antigo**, não a este Remix. Hoje `igreen.cloud` serve o app antigo.

**Decisão necessária:**

- **(A)** Manter `igreen.cloud` apontando para o projeto antigo e usar `igreen-page-magic.lovable.app` para este Remix (teste).
- **(B)** Migrar `igreen.cloud` para este Remix: remover do projeto antigo → publicar este → reconectar domínio (com SSL re-emitido em ~15min).

---

## 6. Facebook / Meta App ✅ Nada muda

App ID, tokens OAuth dos consultores, CAPI pixel — tudo vive no Supabase. **Zero alteração.**

---

## 7. Stripe / Whapi / ElevenLabs / 2Captcha / Gemini ✅ Nada muda

Todos lidos via `Deno.env.get()` nas Edge Functions do Supabase compartilhado.

---

## Resumo Executivo


| Serviço                 | Ação necessária                               |
| ----------------------- | --------------------------------------------- |
| Supabase                | ✅ Nenhuma                                     |
| MinIO                   | ✅ Nenhuma                                     |
| Easypanel (5 workers)   | 🟡 Só checar status online                    |
| Facebook/Meta/Stripe/IA | ✅ Nenhuma                                     |
| GitHub                  | ⚠️ Decidir: conectar novo repo ou não         |
| Domínio `igreen.cloud`  | 🔴 Decidir: ficar no projeto antigo ou migrar |


**Conclusão:** infraestrutura externa **não precisa de mudança técnica** — o Remix herdou tudo via Supabase compartilhado. As duas únicas decisões são organizacionais: **GitHub** (novo repo?) e **domínio** (qual projeto serve `igreen.cloud`?).

Me diga como quer prosseguir nesses dois pontos e eu executo.  
  
O GITHUB AGORA É ESSE [https://github.com/tvmensal2025/igreen-page-magic](https://github.com/tvmensal2025/igreen-page-magic)  
  
E O DOMINIO JA ESTA ATIVO IGREEN.CLOUD