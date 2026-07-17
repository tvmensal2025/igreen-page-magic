# Captação de Leads — o que construímos, por quê e como usar

> Documento mestre da feature de captação. Lê isto e você entende tudo: o que
> cada peça faz, por que existe, e como operar no dia a dia.

---

## 1. O problema que estávamos resolvendo

O objetivo era: **cada consultor captar o maior número possível de pessoas**
(telefone/contato) por Facebook, Instagram, TikTok e WhatsApp, **ser dono dos
próprios leads**, e poder **selecionar contatos para disparar mensagem** — tudo
de forma **legal (LGPD)** e **sem quebrar** nada do que já funciona.

Descartamos de cara três caminhos (são ilegais e queimam a operação):
- ❌ Raspar telefone de perfis do Facebook/Instagram/TikTok.
- ❌ Filtrar/comprar base por CPF de pessoas físicas.
- ❌ Bases compradas/vazadas.

O caminho certo (e que entrega MUITO mais gente) é **captação com
consentimento**: formulários nativos de anúncio (Lead Ads), landing pages e, para
B2B, dados públicos de empresas.

---

## 2. Visão geral (o desenho)

> Identidade (RG antigo / RG novo·CIN / CNH): ver [`DOCUMENTOS-RG-CNH-CIN.md`](./DOCUMENTOS-RG-CNH-CIN.md).  
> **RG novo 2026 / CIN = só CPF — não pedir número de RG.**  
> Ordem final: [`ORDEM-OTP-ANTES-FACIAL.md`](./ORDEM-OTP-ANTES-FACIAL.md) — **OTP primeiro, facial depois**.

```
[Meta Lead Ads]  ─┐
[TikTok LeadGen] ─┤
[Click-to-WhatsApp]┤
[Landing page]   ─┼─► ingestLead() ─► captured_leads  (dono = consultor,
[Pesquisa B2B]   ─┘                      dedup, consentimento, PF/PJ)
                                            │
                          ┌─────────────────┼───────────────────────┐
                          │                 │                       │
              consultor seleciona     PF energia            captacao-intel
              e dispara ──► bulk_      ──► customers          (IA já existente
              campaigns ──► bulk-          (fluxo de            enxerga tudo)
              scheduler (anti-ban)         cadastro atual)
                                       PJ/outros ──► sales
```

**Princípio que seguimos:** cada canal novo é uma **função isolada** que só
chama um motor compartilhado (`ingestLead`). Assim um canal nunca quebra o
outro, e nada do funil/disparo existente foi alterado.

---

## 3. O que foi construído (peça por peça)

### 3.1 Banco de dados (2 tabelas novas)

**`captured_leads`** — o "balde" onde todo lead captado cai primeiro.
- Por quê: a tabela `customers` de hoje é desenhada só para energia-PF (CPF, RG,
  conta de luz). Não dava pra enfiar PJ nem leads crus lá. Então criamos um
  buffer neutro que serve PF e PJ.
- Campos principais: `consultant_id` (dono), `channel` (de onde veio),
  `person_type` (pf/pj), nome/telefone/email/cidade, campos PJ
  (`company_name`, `cnpj`, `pj_data`), consentimento (`consent_text/at/source`),
  `dedup_key` (anti-duplicado), `status`.
- Quando o lead "vira cliente": aponta para `customers` (PF energia) ou `sales`
  (PJ/outros produtos) — reaproveitando o funil que já existe.

**`lead_consent_log`** — a prova de LGPD.
- Por quê: numa fiscalização da ANPD, você precisa provar que a pessoa
  consentiu. Esta tabela guarda o texto exato do opt-in, canal, IP e data.

**Segurança (RLS):** cada consultor só enxerga e mexe nos **próprios** leads
(`consultant_id = auth.uid()`). O super admin vê tudo (suporte). A escrita é
feita pelas edge functions com service role.

> Migrations versionadas:
> `supabase/migrations/20260626163336_captured_leads_and_consent.sql` e
> `..._fix_captured_leads_touch_search_path.sql`.

### 3.2 Motor compartilhado (`_shared/captation/`)

**`lead-ingest.ts`** — a porta ÚNICA de gravação. Todo canal chama isto.
- O que faz: normaliza o telefone (`55 + DDD + número`), deduplica por consultor,
  separa PF/PJ, grava o lead e dispara o registro de consentimento.
- Por que é importante: centralizar aqui significa que normalização, dedup e
  LGPD acontecem do mesmo jeito para todos os canais. Um lugar só pra manter.

**`consent.ts`** — grava a trilha de consentimento (LGPD), à prova de falha
(nunca derruba a captação se a gravação de auditoria falhar).

Cobertura de testes: **8 testes unitários** (dedup, normalização, PF/PJ,
consentimento).

### 3.3 Conectores (5 edge functions novas)

| Função | O que faz | Acesso |
|---|---|---|
| `lead-intake` | Porta HTTP pública para **landing pages**. Recebe lead + opt-in. | Pública (resolve o dono pela licença do consultor) |
| `meta-leadads-webhook` | Recebe **Meta Lead Ads** (FB/Insta). Valida assinatura, busca o lead na Graph API, grava. | Pública (assinada pelo Meta) |
| `tiktok-leadgen-webhook` | Recebe **TikTok Lead Generation**. Valida segredo, grava. | Pública (segredo no header) |
| `lead-research` | **Pesquisa B2B** de empresas por cidade/ramo (OpenStreetMap). Resultados viram leads PJ do consultor. | Logado (consultor) |
| `leads-to-campaign` | Consultor **seleciona leads e dispara**. Cria a campanha de Disparo PRO. | Logado (consultor) |

### 3.4 O que reaproveitamos (não recriamos)

- **Disparo em massa:** `bulk_campaigns` + `bulk-scheduler` (cron) + `anti-ban.ts`
  (aquecimento de chip, intervalo humano, "digitando...", circuit breaker). O
  `leads-to-campaign` só alimenta esse motor; o envio em si é o que já existia.
- **Atribuição de campanha Meta:** `ctwa_clid`, `lead-source.ts`,
  `facebook_campaigns` — para ligar o lead à campanha de origem.
- **Funil:** `customers` (PF energia) e `sales`/`products` (multiproduto).

---

## 4. O que já foi testado AO VIVO (e o que falta)

✅ **Validado em produção (testes reais):**
- Webhook do Meta — handshake (verificação) responde 200.
- Webhook do Meta — POST sem assinatura é rejeitado (401). Proteção OK.
- Ingestão de lead pela `lead-intake`: gravou com dono correto, telefone
  normalizado, consentimento na trilha LGPD, e dedup funcionando (2 envios = 1
  lead).

⏳ **Falta para o Meta funcionar 100% (configuração, não código):**
- Secret `PAGE_ACCESS_TOKEN` (token da Página com permissão `leads_retrieval`).
- Secret `META_LEADADS_FALLBACK_CONSULTANT` = `0c2711ad-4836-41e6-afba-edd94f698ae3` (Rafael).
- Configurar o webhook no painel do Meta e assinar o campo `leadgen`.
- (Guia completo em `COMO-CONFIGURAR-SECRETS.md`.)

🚧 **Ainda não construído:**
- **UI do consultor** (tela para ver os leads, filtrar, selecionar e disparar).
  Hoje os leads são visíveis no Supabase (Table Editor → `captured_leads`).
- Ativação do Google Places (a pesquisa B2B usa OpenStreetMap por enquanto).

---

## 5. Como usar (passo a passo por canal)

### Canal: Landing page (funciona JÁ, sem configurar nada)
O site/landing faz um POST para a função, com o opt-in que a pessoa aceitou:

```
POST https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-intake
Content-Type: application/json

{
  "license": "rafael-ferreira",          // licença do consultor dono
  "channel": "landing",
  "person_type": "pf",                     // ou "pj"
  "full_name": "Maria Silva",
  "phone": "(11) 99999-0001",
  "email": "maria@exemplo.com",
  "city": "Campinas",
  "uf": "SP",
  "consent_text": "Aceito receber contato da iGreen sobre energia.",
  "consent_source": "lp-energia-campinas"
}
```
O lead cai em `captured_leads` já atribuído ao consultor da licença.

### Canal: Pesquisa B2B (funciona JÁ — o consultor logado dispara)
O consultor (logado) chama a função com cidade + ramo:

```
POST https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-research
Authorization: Bearer <token do consultor>

{ "city": "Campinas", "uf": "SP", "category": "restaurant", "limit": 100 }
```
A função busca empresas com telefone público no OpenStreetMap e grava como
leads PJ do consultor.

### Canal: Meta Lead Ads (precisa dos secrets do guia)
1. Configure os secrets e o webhook (ver `COMO-CONFIGURAR-SECRETS.md`).
2. Crie a campanha de Lead Ads no Gerenciador de Anúncios da Meta.
3. Os leads caem sozinhos em `captured_leads` (`channel = meta_leadads`).

### Canal: TikTok Lead Generation (precisa dos secrets do guia)
Mesma lógica do Meta, com a URL `.../tiktok-leadgen-webhook`.

### Disparar mensagem para leads selecionados
O consultor (logado) manda a lista de leads escolhidos:

```
POST https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/leads-to-campaign
Authorization: Bearer <token do consultor>

{
  "lead_ids": ["uuid-1", "uuid-2", "..."],
  "campaign_name": "Oferta energia Campinas",
  "message_text": "Oi {primeiro_nome}, tudo bem? ..."
}
```
Isso cria uma campanha de Disparo PRO; o `bulk-scheduler` envia com anti-ban
(aquecimento, intervalos humanos). Hoje isso é via API; a UI vai botar um botão
"Enviar" em cima disso.

---

## 6. Onde ver os leads hoje

Enquanto a UI do consultor não existe, dá pra ver tudo no Supabase:
- **Table Editor → `captured_leads`**:
  https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor
- Filtre por `consultant_id` para ver os de um consultor específico.

---

## 7. LGPD — por que isso é seguro

1. **Base legal = consentimento.** Todo lead entra por opt-in; o texto fica
   gravado em `lead_consent_log`.
2. **Finalidade declarada** no formulário ("receber contato da iGreen").
3. **Opt-out:** marcar o lead como `discarded` e expurgar.
4. **Sem dado proibido:** nada de CPF de terceiros, scraping ou base comprada.
5. **Isolamento:** cada consultor só acessa os próprios leads (RLS).

---

## 8. Mapa dos arquivos

```
docs/captacao/
  README.md                      ← este documento
  PLANO-CAPTACAO-LEADS.md        ← o plano técnico completo
  COMO-CONFIGURAR-SECRETS.md     ← passo a passo dos secrets (Meta/TikTok/Google)

supabase/functions/
  lead-intake/                   ← porta pública (landing)
  meta-leadads-webhook/          ← conector Meta Lead Ads
  tiktok-leadgen-webhook/        ← conector TikTok
  lead-research/                 ← pesquisa B2B (OpenStreetMap)
  leads-to-campaign/             ← seleção → disparo
  _shared/captation/
    lead-ingest.ts               ← motor único de gravação
    lead-ingest_test.ts          ← 8 testes
    consent.ts                   ← trilha LGPD

supabase/migrations/
  20260626163336_captured_leads_and_consent.sql
  20260626163353_fix_captured_leads_touch_search_path.sql
```

---

## 9. Status final

| Item | Status |
|---|---|
| Tabelas + RLS + migrations versionadas | ✅ pronto |
| Motor de ingestão + 8 testes | ✅ pronto e testado ao vivo |
| `lead-intake` (landing) | ✅ no ar e testado |
| `lead-research` (B2B OpenStreetMap) | ✅ no ar |
| `leads-to-campaign` (disparo) | ✅ no ar |
| `meta-leadads-webhook` | ✅ no ar (handshake + assinatura validados) |
| `tiktok-leadgen-webhook` | ✅ no ar (falta secret do TikTok) |
| Secrets do Meta (PAGE_ACCESS_TOKEN, fallback) | ⏳ você configura |
| UI do consultor | 🚧 a construir |
| Google Places na pesquisa B2B | 🚧 opcional, a ativar |
```

