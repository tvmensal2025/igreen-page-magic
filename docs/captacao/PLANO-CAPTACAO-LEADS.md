# Plano de Captação de Leads em Massa (multicanal)

> Objetivo: cada **consultor** capta o **maior número possível de pessoas**
> (telefone/contato com consentimento) por Facebook, Instagram, TikTok e
> WhatsApp, **faz sua própria pesquisa**, é **dono dos próprios leads**, e pode
> **selecionar contatos para disparar mensagem** — tudo de forma **legal
> (LGPD)** e **sem quebrar** nenhuma função que já roda hoje.

## 0. Quem é o dono (modelo multi-tenant por consultor)

Regra central: **o lead pertence ao consultor que o gerou.**

- Cada consultor roda a própria pesquisa/captação (campanhas, landing, busca).
- Os leads captados ficam isolados por `consultant_id` (RLS). Um consultor
  nunca vê a base do outro.
- O consultor abre a lista, **seleciona** as pessoas que quer e **dispara** a
  mensagem — reaproveitando o motor de Disparo PRO que já existe
  (`bulk_campaigns` + `bulk-scheduler` + anti-ban).
- SuperAdmin só tem visão global para suporte/auditoria.

---

## 1. O que já existe (não mexer, só reaproveitar)

O projeto já tem uma engrenagem de captação madura. O plano **soma** a ela, não
substitui:

| Peça existente | O que faz | Onde fica |
|---|---|---|
| `facebook-create-campaign` e cia | Cria/gerencia campanhas Meta Ads | `supabase/functions/facebook-*` |
| `ctwa-status` | Pré-voo do Click-to-WhatsApp (Pixel/Página/Número) | `supabase/functions/ctwa-status` |
| `ctwa_clid_mapping` (migration) | Liga o clique do anúncio ao lead | migration `20260611...ctwa_clid_mapping` |
| `_shared/captation/lead-source.ts` | Marca origem do lead (CTWA, msg, regex) | `_shared/captation` |
| `_shared/lead-attribution.ts` | Atribui lead → campanha Meta | `_shared` |
| `captacao-intel` | IA cruza funil + criativos + concorrentes | `supabase/functions/captacao-intel` |
| `evolution-webhook` / `whapi-webhook` | Recebe mensagens WhatsApp e dispara fluxo | `supabase/functions` |
| `bulk_campaigns` + `bulk-scheduler` | Disparo PRO em massa (cria campanha, cron envia) | `supabase/functions/bulk-scheduler` |
| `_shared/anti-ban.ts` | Warmup, intervalo humano, circuit breaker, trava de chip | `_shared` |

**Conclusão:** o canal Meta→WhatsApp (CTWA) já está pronto. O que falta é:
1. Um ponto de entrada **único e isolado** para leads de QUALQUER canal.
2. Os conectores novos: **Meta Lead Ads (formulário nativo)** e **TikTok Lead Generation**.
3. Landing pages com formulário (opt-in próprio).

---

## 2. Princípio de isolamento (não quebrar nada)

Regra de ouro: **canal novo = função nova + módulo novo**. Nada de editar
`evolution-webhook` ou as funções `facebook-*`.

```
supabase/functions/
  lead-intake/                 ← NOVO. Porta única de entrada de leads.
  meta-leadads-webhook/        ← NOVO. Recebe Lead Ads do Facebook/Instagram.
  tiktok-leadgen-webhook/      ← NOVO. Recebe Lead Generation do TikTok.
  _shared/captation/
    lead-source.ts             ← já existe (não mexer)
    lead-ingest.ts             ← NOVO. Normaliza + grava + dedup. Reusável.
    consent.ts                 ← NOVO. Registra base legal/opt-in (LGPD).
```

Cada webhook novo só faz: validar assinatura → montar payload padronizado →
chamar `lead-ingest.ts`. Toda a lógica compartilhada fica em `_shared`, então
um canal nunca afeta o outro.

---

## 3. Modelo de dados (migrations novas, aditivas)

Nada de alterar tabelas existentes de forma destrutiva. Só **adicionar**.

> Decisão importante: a tabela `customers` de hoje é desenhada para **energia
> PF** (cpf, rg, conta de luz, OCR, portal). Não vamos forçar PJ lá dentro nem
> adicionar dezenas de colunas. O buffer `captured_leads` guarda tanto PF
> quanto PJ de forma neutra (campos comuns + um `pj_data` jsonb), e só na hora
> de converter é que decidimos o destino certo no funil.

### 3.1 Tabela `captured_leads` (nova) — atende PF e PJ
Buffer de captação antes de virar `customer`/`sale`. Mantém o funil atual intacto.

```sql
create table public.captured_leads (
  id uuid primary key default gen_random_uuid(),
  channel text not null,               -- meta_leadads | tiktok_leadgen | ctwa | landing | manual
  person_type text not null default 'pf'  -- pf | pj
    check (person_type in ('pf','pj')),

  -- comuns aos dois
  full_name text,                       -- PF: nome | PJ: nome do contato
  phone text,                           -- E.164 normalizado
  email text,
  city text,
  uf text,
  product_interest text,                -- energia | placas | telecom | etc (products.slug)

  -- só PJ (preenchido quando person_type='pj')
  company_name text,                    -- razão social / nome fantasia
  cnpj text,
  pj_data jsonb not null default '{}',  -- porte, ramo (CNAE), nº de filiais, etc.

  raw_payload jsonb not null default '{}',
  consent_text text,                    -- texto exato do opt-in mostrado ao lead
  consent_at timestamptz,               -- quando consentiu
  consent_source text,                  -- url/form_id de onde veio o consentimento
  source_campaign_id uuid references public.facebook_campaigns(id),
  ctwa_clid text,
  dedup_key text,                       -- hash(person_type|cnpj|phone|email)
  status text not null default 'new'    -- new | enriched | converted | discarded
    check (status in ('new','enriched','converted','discarded')),
  customer_id uuid references public.customers(id),  -- quando vira customer (PF energia)
  sale_id uuid references public.sales(id),          -- quando vira venda multiproduto
  consultant_id uuid references public.consultants(id),
  created_at timestamptz not null default now(),
  unique (dedup_key)
);
create index on public.captured_leads (channel, created_at desc);
create index on public.captured_leads (person_type, status);
create index on public.captured_leads (phone);
create index on public.captured_leads (cnpj) where cnpj is not null;
```

RLS: a porta de entrada (edge functions) escreve com service role. **Cada
consultor só enxerga e mexe nos próprios leads** (`consultant_id = auth.uid()`),
igual ao padrão de `customers`/`crm_deals`. SuperAdmin tem visão global só para
suporte. Ou seja: lead captado é **do consultor que o gerou**, ninguém vê a base
do outro.

### 3.1.1 Conversão para o funil (PF x PJ)
- **PF energia** → vira `customers` (reusa todo o fluxo de cadastro/portal que
  já existe). `captured_leads.customer_id` aponta pra ele.
- **PJ (ou PF de outros produtos)** → vira `sales` (pipeline multiproduto que já
  existe na tabela `sales` + `products`). `captured_leads.sale_id` aponta pra ela.

Assim cada tipo cai na esteira certa **sem inventar tabela nova de cliente**.

### 3.2 Tabela `lead_consent_log` (nova) — prova de LGPD
Guarda a evidência de consentimento (quem, quando, qual texto). Isso é o que
protege a iGreen numa fiscalização da ANPD.

```sql
create table public.lead_consent_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.captured_leads(id),
  consent_text text not null,
  channel text not null,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
```

---

## 4. Os canais (do maior volume legal para o menor esforço)

### Canal A — Meta Lead Ads (Facebook + Instagram) ⭐ prioridade
Anúncio com **formulário nativo**: nome/telefone/e-mail já vêm preenchidos pelo
cadastro do usuário, ele confirma com 1 toque. Consentimento embutido.

- **Função nova:** `meta-leadads-webhook`
- Como funciona: Meta manda webhook `leadgen` → função busca o lead via Graph
  API (`/{leadgen_id}`) → normaliza → `lead-ingest`.
- Reaproveita: `_shared/fb-graph.ts`, `_shared/fb-crypto.ts` (já existem).
- Verificação de assinatura: `X-Hub-Signature-256` (HMAC do app secret).
- **PF e PJ:** dá pra ter 2 formulários (campanha PF pede nome+telefone;
  campanha PJ pede empresa+CNPJ+contato). O `person_type` vem de um campo
  oculto do form ou do nome da campanha. Cai no mesmo webhook.

### Canal B — TikTok Lead Generation
Mesma lógica: formulário nativo dentro do anúncio TikTok.

- **Função nova:** `tiktok-leadgen-webhook`
- TikTok manda webhook → busca lead via TikTok Marketing API → `lead-ingest`.
- Público mais jovem; bom para volume incremental.

### Canal C — Click-to-WhatsApp (CTWA) — JÁ EXISTE
Não precisa construir. Só garantir que o lead que cai no WhatsApp via anúncio
também seja gravado em `captured_leads` (o `lead-source.ts` já marca origem;
adicionamos uma chamada fire-and-forget pro `lead-ingest`).

### Canal D — Landing page + tráfego pago
Página de oferta com formulário próprio (opt-in 100% nosso). Tráfego vem de
Meta/TikTok/Google. Você vira dono da base.

- Form do front chama `lead-intake` (porta única) com o texto de consentimento.

### Canal E — Pesquisa de empresas pelo próprio consultor (B2B)
Para o consultor que quer prospectar PJ ativamente (não só esperar o anúncio).

- **Função nova:** `lead-research` (busca empresas por cidade + ramo).
- Fontes legais de **pessoa jurídica** (dado público, sem LGPD travando):
  - **Google Places API** (telefone/site/endereço de estabelecimentos).
  - **OpenStreetMap / Overpass** (gratuito, complementa).
  - **Base pública de CNPJ da Receita** (universo completo por cidade/CNAE).
- O consultor escolhe cidade + ramo, a função varre, deduplica e grava em
  `captured_leads` (person_type='pj', channel='research') **com o
  `consultant_id` dele**. Os resultados são dele.
- Esses são contatos comerciais públicos de PJ — abordagem B2B é permitida.
  Mesmo assim, todo disparo respeita opt-out e o anti-ban do WhatsApp.

---

## 4.1 Seleção + disparo (o consultor escolhe e envia)

O consultor abre a lista dos **leads dele**, marca os que quer (checkbox /
selecionar todos / filtrar por cidade/ramo/canal) e clica em "Enviar mensagem".

Reaproveita 100% o motor de Disparo PRO existente — **nada novo de envio**:

```
captured_leads (selecionados) ──► cria bulk_campaigns + bulk_campaign_targets
                                         │
                                         └─► bulk-scheduler (cron) dispara
                                             com anti-ban / warmup / typing
```

- **Função nova fininha:** `leads-to-campaign` — recebe a lista de `lead_id`
  selecionados + texto/mídia, cria 1 `bulk_campaigns` e insere os
  `bulk_campaign_targets` (telefone normalizado, vars de nome/cidade). Só isso.
- O `bulk-scheduler` que já existe assume o envio, respeitando warmup, intervalo
  humano, circuit breaker e a trava de instância. **Não tocamos nele.**
- Proteção contra spam/ban já vem de graça (o `anti-ban.ts` cuida).

---

## 5. Fluxo unificado (depois que o lead entra)

```
[Meta Lead Ads]  ─┐
[TikTok LeadGen] ─┤
[CTWA WhatsApp]  ─┼─► lead-ingest.ts ─► captured_leads (dono=consultor, dedup, consent, PF/PJ)
[Landing page]   ─┤                         │
[Pesquisa B2B]   ─┘                         │
                                            ├─ consultor seleciona ─► leads-to-campaign
                                            │                          └─► bulk_campaigns ─► bulk-scheduler (anti-ban)
                                            ├─ PF energia ─► customers ─► fluxo WhatsApp/portal atual
                                            ├─ PJ / outros ─► sales + products (pipeline multiproduto)
                                            └─► captacao-intel enxerga tudo
```

O lead é **do consultor** desde que nasce. Ele decide quem abordar (seleção +
disparo) e, quando converte, cai na esteira certa que já existe (PF energia no
fluxo de cadastro; PJ/outros produtos no pipeline de vendas). Zero retrabalho no
funil atual.

---

## 6. LGPD — o que torna isso legal (e seguro)

1. **Base legal = consentimento.** Todo canal captura via formulário com opt-in
   explícito. O texto do consentimento é gravado em `lead_consent_log`.
2. **Finalidade declarada:** "receber contato da iGreen sobre energia".
3. **Opt-out fácil:** lead pode pedir remoção (status `discarded` + expurgo).
4. **Sem dado proibido:** nada de CPF de terceiros, nada de base comprada, nada
   de scraping de perfil. Só dado que a pessoa entregou.

> Sem esses 4 pontos, captação em massa vira risco de multa de até 2% do
> faturamento. Com eles, é volume alto e tranquilo.

---

## 7. Ordem de execução (incremental, testável a cada passo)

| Etapa | Entrega | Risco de quebrar algo |
|---|---|---|
| 1 | Migrations `captured_leads` + `lead_consent_log` (RLS por consultor) | Nenhum (só cria tabela) |
| 2 | `_shared/captation/lead-ingest.ts` + `consent.ts` + testes | Nenhum (módulo novo) |
| 3 | `lead-intake` (porta única) + landing form | Nenhum (função nova) |
| 4 | `meta-leadads-webhook` | Nenhum (função nova) |
| 5 | `tiktok-leadgen-webhook` | Nenhum (função nova) |
| 6 | Plugar CTWA no `lead-ingest` (1 chamada fire-and-forget) | Baixo — só adiciona uma gravação assíncrona |
| 7 | `lead-research` (pesquisa B2B de empresas pelo consultor) | Nenhum (função nova) |
| 8 | Painel do consultor: lista os leads dele + filtros + seleção | Nenhum (UI nova) |
| 9 | `leads-to-campaign` (seleção → `bulk_campaigns`) reusando o disparo | Baixo — só cria linhas, não toca o scheduler |

Cada etapa: `npx tsc --noEmit` + `npx vite build` antes de commitar (regra do
projeto). Deploy das functions só via GitHub Actions (workflow já configurado).

---

## 8. O que NÃO entra (e por quê)

- ❌ Scraping de telefone de perfis Facebook/Instagram/TikTok → proibido nos
  termos das plataformas + ilegal (LGPD). Banimento de conta garantido.
- ❌ Filtro/enriquecimento por CPF de pessoas físicas → dado pessoal sem base
  legal. Risco de multa e processo.
- ❌ Bases compradas/vazadas → crime + queima o número de WhatsApp por spam.

Volume legal (Lead Ads + TikTok + landing) entrega MUITO mais gente que
qualquer scraping, e sem risco de derrubar o número de WhatsApp.
```

