# Anúncios — ajustes para começar a publicar

## 1. Remover o atalho grande "Replicar campanha Uberlândia"

- `AdsCentralTab.tsx`: tirar o `ReplicateUberlandiaCard` do bento do dashboard e deixar o KPI hero (`AdMetricsCards`) ocupar a linha inteira (`colSpan=12`).
- Apagar o arquivo `src/components/admin/ads/ReplicateUberlandiaCard.tsx` (não é mais usado em lugar nenhum depois desse passo).

## 2. Um único botão "Criar campanha" (modo avançado sempre)

- No header do `AdsCentralTab.tsx`, remover o botão "Avançado" e manter só o CTA dourado **"Criar campanha"**, que abre direto o `CreateCampaignWizard` (modo completo).
- Apagar o `ExpressCampaignDialog` da rota do header (mantém o arquivo no repo por enquanto pra não quebrar nada que ainda importe; é só deixar de abrir).
- No wizard, remover o link "Modo avançado (controle total)" — não faz mais sentido com um único caminho.

## 3. Miniatura (vídeo/imagem) em TODA campanha listada

- Em `CampaignsList.tsx`, ao carregar campanhas, buscar também o criativo vinculado (preferência: `ad_template_usages.template_id` → `ad_templates.video_thumb_url` / `photos[0].url`; fallback: primeiro item de `facebook_creative_packs` ou `ad_image_library` do consultor associado à campanha).
- Renderizar um thumbnail 64×64 (quadrado) à esquerda de cada card de campanha:
  - Se houver `video_url` ou `video_thumb_url` → mostra a thumb com um ícone de "play" sobreposto.
  - Se houver foto → mostra a foto.
  - Sem mídia → placeholder cinza com ícone de imagem e texto "Sem criativo".
- Mesmo tratamento na visão compacta da lista (mobile).

## 4. Bônus editável pelo admin (não fixar 100%)

Hoje os rótulos dizem "Bônus até 100% / 50%", mas no campo a média real é 60%. O super-admin precisa editar.

- Migration nova: criar tabela `public.ad_bonus_tiers` com colunas `tier` (`alto`|`medio`|`sem_bonus`), `label`, `percent` (int), `updated_by`. Seed inicial: `alto=60`, `medio=30`, `sem_bonus=0`. Inclui GRANTs + RLS (leitura `authenticated`, escrita só `admin` via `has_role`).
- Novo card em **Configurações do admin** ("Bônus por tier de distribuidora") para editar os 3 valores.
- `CreateCampaignWizard.tsx` e `UseTemplateDialog.tsx`: ler `ad_bonus_tiers` no mount e substituir todo texto hardcoded "100% / 50%" pelo valor vindo do banco (ex: "🟢 Bônus até {alto}%", botão "Carregar TODAS {alto}%", toast também).
- Esse número é só rótulo/UX — não muda a lógica do `loadAllOfTier`.

## 5. Não carregar todas as cidades de uma vez (limite 5M)

- Remover os botões **"Carregar TODAS 100%"** e **"Carregar TODAS 50%"** do wizard.
- Substituir por uma única ação **"Sugerir 8 cidades fortes deste tier"** que pega as N melhores (já temos `loadPresetCities` com `budgetLeft`); aplica preset por preset com cap=8 cidades/preset e cap global=50 cidades.
- Mostrar contador "X / 50 cidades selecionadas" e badge amarelo quando passar de 30 ("alcance grande, CPL pode subir").
- Tooltip explicando: "Carregar tudo cria audiência de milhões e diluiu o anúncio — selecione manualmente ou use os atalhos."

## 6. Visual mais profissional (ambos os modos)

Polimento focado, sem mudar layout estrutural:

- **Cards de campanha** (`CampaignsList.tsx`): bordas `border-[hsl(var(--ads-border))]`, gradiente sutil do tema dourado/verde no topo da campanha ativa, status como `Badge` com dot animado quando `active`, KPIs (gasto/leads/CPL) em grid de 3 com tipografia consistente (`font-heading` no número, `text-muted-foreground` no rótulo).
- **Wizard** (`CreateCampaignWizard.tsx`):
  - Tabs "Cidades inteiras" / "Endereço + raio" viram pílulas grandes com ícone à esquerda e descrição embaixo ("Cidades inteiras — alcance maior" / "Endereço + raio — ultra-local, menos desperdício").
  - Seção de distribuidoras: cada tier vira um bloco com cor de borda (verde / âmbar / cinza), o percentual vindo do banco em destaque grande no canto.
  - Step indicator no topo (`1 Mídia · 2 Público · 3 Orçamento · 4 Revisão`) com a etapa atual em dourado.

## Resumo técnico

- Arquivos editados: `AdsCentralTab.tsx`, `CampaignsList.tsx`, `CreateCampaignWizard.tsx`, `UseTemplateDialog.tsx`, novo `BonusTiersAdminCard.tsx`, settings tab do `Admin.tsx` (registrar o card).
- Arquivo removido: `ReplicateUberlandiaCard.tsx`.
- 1 migration: tabela `ad_bonus_tiers` + GRANT + RLS + seed.
- Sem mudança em edge functions.

## Pergunta antes de implementar

- Confirma os valores iniciais **alto = 60%**, **médio = 30%**, **sem bônus = 0%**? Se preferir outros, me diz que já entra no seed. deixe editavel