# Galeria de Materiais no Admin

Substituir o `MaterialsTab` atual (que só tem um botão pro Google Drive) por uma **galeria completa** com todas as mídias usadas nas páginas públicas (Licenciada + Consultor/Cliente), agrupadas por seção da página, com **Download** e **Enviar via WhatsApp**.

## O que vai aparecer

Agrupado por seção (abas/accordion), espelhando o site:

- **Notícias** — 7 vídeos (`noticia1..6.mp4` + `noticaia9.mp4`)
- **Depoimentos** — 5 vídeos (`/videos/depoimento-1..5.mp4`)
- **Cashback / Referral** — `cash-back-igreen.mp4`
- **Como funciona** — `casasustentavel.mp4`
- **Hero (cliente)** — `Green_Energy.mp4`
- **Usina** — `usina-helio-valgas.mp4`
- **Club de benefícios** — `club-de-beneficios.mp4`, `igreen_club_3.mp4` + banners (`club-banner-1..7.png`, `lojas-parceiras.png`)
- **Licenciada — Hero / Why / Conexões** — `imagine-licenciado.mp4`, `Licenciadao-1.mp4`, `conexao-livre.webp`, `conexao-green.webp`, `conexao-expansao.webp`, `conexao-club.webp`, `conexao-solar.webp`, `conexao-telecom.webp`, `kit-licenciado-igreen.png`, `assinatura-empresarial.png`, `planos-igreen-telecom.png`, `qualificacoes-igreen.png`
- **Conta de energia (Assistente)** — `conta-de-energia.mp4`, `WhatsApp Video 2025-05-29...mp4`
- **Banners/Flyers Lei 14.300** — `mutirao-lei-14300.jpg`, `mutirao-lei-14300-base.jpg`, `banner-lei-14300-base.jpg`
- **Botão "Abrir Drive"** continua no topo como atalho secundário.

Catálogo declarado **em código** (array tipado em `src/lib/materialsCatalog.ts`) — sem precisar de tabela nova. Cada item: `{ id, title, section, type: 'video'|'image', url, thumbUrl?, sizeHint? }`.

## Ações por mídia

Cada card tem:

1. **▶ Preview inline** — `<video controls>` (com `preload="metadata"`) ou `<img>` em lightbox.
2. **⬇ Download** — `<a href={url} download>` (URLs do Supabase Storage / `/videos/` / `/images/` já são públicas, então funciona sem proxy).
3. **📋 Copiar link** — copia URL absoluta pra área de transferência.
4. **💬 Enviar via WhatsApp** — abre um popover com 2 opções:
   - **Compartilhar (wa.me)**: abre `https://wa.me/?text={titulo}%20{url}` numa nova aba — funciona em qualquer celular/desktop, não precisa de instância conectada.
   - **Enviar pela minha instância**: input de telefone (com máscara BR), chama a Evolution via helper já existente `sendMedia(chatId, mediaUrl, caption, mediatype)` em `supabase/functions/_shared/whatsapp-api.ts`. Reusa a instância configurada do consultor logado (mesmo padrão do envio em massa). Mostra toast de sucesso/erro.

## Estrutura técnica

- **Novo:** `src/lib/materialsCatalog.ts` — catálogo tipado.
- **Novo:** `src/components/admin/materials/MaterialCard.tsx` — preview + 3 botões + popover WhatsApp.
- **Novo:** `src/components/admin/materials/SendViaWhatsAppPopover.tsx` — input telefone + chamada Evolution.
- **Nova edge function:** `supabase/functions/admin-send-material/index.ts` — recebe `{ phone, mediaUrl, caption, mediatype }`, valida JWT do consultor, busca a `instance_name` do consultor em `whatsapp_instances`, chama `sendMedia` do helper compartilhado. Deploy automático.
- **Refator:** `src/components/admin/MaterialsTab.tsx` — passa a renderizar `<Tabs>` por seção + grid de cards. Botão "Abrir Drive" continua no topo.

## Fora de escopo

- Não cria tabela nova (catálogo em código — fácil de evoluir depois pra DB se virar caso).
- Não mexe nas páginas públicas (NewsSection, TestimonialsSection, Licenciada, etc).
- Não troca o pipeline de envio em massa — apenas reusa o `sendMedia` helper.
- Whapi legado não é chamado (helper unificado já é Evolution); se quiser fallback Whapi explícito, é incremento futuro.
