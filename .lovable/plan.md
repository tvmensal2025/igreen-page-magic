# Campanha "28% Análise" — Uberlândia + 100km (Meta Ads)

Foco exclusivo em **Facebook + Instagram** (Meta Ads), aproveitando a conta/Pixel já configurados. Duas entregas:

1. Configuração pronta para colar no Meta Ads Manager (R$70/dia)
2. Sistema de templates de campanha no app, reutilizável para futuras cidades

---

## Parte 1 — Configuração pronta (Meta Ads)

### Campanha

- **Objetivo:** Cadastros (Leads)
- **Tipo de lead:** Formulário Instantâneo do Facebook (recomendado — CPL 40–60% menor que tráfego pro site). Alternativa: Conversões com Pixel + evento `Lead` em `igreen.cloud`.
- **Orçamento:** R$50/dia (CBO — Advantage Campaign Budget)
- **Estratégia de lance:** Volume mais alto (sem limite de custo)
- **Data:** Início imediato, sem data de término

### Conjunto de Anúncios (1 só — não fragmentar)

- **Localização:** Uberlândia, MG — raio **100 km** — "Pessoas que moram neste local"
- **Idade:** 28–65
- **Gênero:** Todos
- **Idioma:** Português
- **Segmentação detalhada** (Advantage detailed targeting ON — deixar Meta expandir):
  - Proprietários de imóveis
  - Conta de luz / Energia elétrica / Cemig
  - Pequenas empresas / Donos de empresa
  - Sustentabilidade / Energia solar
- **Posicionamentos:** Advantage+ (automático — Feed, Stories, Reels, Explore, etc.)
- **Otimização da entrega:** Leads

### Criativo

- **Vídeo:** o mesmo já usado na campanha "28% Análise"
- **Título principal:**  Tenha até`28% de economia na energia.`
- **Texto principal (copy):**
  > Sua conta de luz pode ficar até **28% mais barata** sem obra, sem troca de fiação e sem instalar nada. Faça sua análise gratuita em 2 minutos. ⚡
- **CTA:** "Cadastre-se" (formulário instantâneo) ou "Saiba mais" (tráfego)
- **URL (se tráfego):** `https://igreen.cloud/?utm_source=meta&utm_medium=cpc&utm_campaign=uberlandia_100km&utm_content=video_28`

### Regras para gastar pouco / captar muito

1. **1 criativo + 1 público** — nunca fragmentar
2. Não editar a campanha nos primeiros **4 dias** (zera aprendizado)
3. Deixar a IA do Meta otimizar **7 dias** antes de qualquer ajuste
4. Formulário instantâneo > tráfego para site (menos fricção, CPL menor)
5. Se o CPL passar de R$15 após 7 dias, trocar o **título** primeiro (não o público)

---

## Parte 2 — Sistema de templates de campanha no app

Nova seção `/campanhas` acessível pelo menu lateral.

### Funcionalidades

- Lista de templates salvos (cards)
- Botão **"Novo template"** → formulário
- Botão **"Duplicar e adaptar"** em cada card → clona para outra cidade
- Botão **"Copiar configuração"** → coloca no clipboard a config formatada (igual à Parte 1) pronta para colar no Ads Manager
- Botão **"Exportar .txt"** → baixa arquivo texto

### Campos do template

- Nome (ex: "Uberlândia 100km — 28% Análise")
- Cidade-âncora + raio (km)
- Faixa etária (min/max)
- Interesses (lista editável)
- Orçamento diário (R$)
- Título do criativo
- Copy principal
- URL do vídeo (link do criativo já existente — não upload)
- URL de destino + UTMs auto-geradas a partir do nome
- Observações

### Pré-populado

Template **"Uberlândia 100km — 28% Análise"** já criado com toda a config da Parte 1.

### Implementação técnica

- Tabela `campaign_templates` no Supabase com RLS escopada a `auth.uid()` do consultor
- GRANTs explícitos para `authenticated` e `service_role`
- Página `src/pages/Campanhas.tsx` + componentes `CampaignTemplateList`, `CampaignTemplateForm`, `CampaignTemplateCard`
- Função utilitária `generateMetaAdsConfig(template)` que monta o texto de saída no formato da Parte 1
- Geração de UTM automática (slug do nome do template)
- Item novo no menu lateral

---

## Fora do escopo

- Integração direta com Meta Marketing API (exige OAuth + Business Manager + revisão da Meta — Fase 2)
- Tracking de performance dentro do app (mesma razão)
- Google Ads (removido a pedido do usuário)