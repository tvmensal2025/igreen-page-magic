## Diagnóstico (revisão em 390px – iPhone)

Naveguei nas duas páginas pelo browser do sandbox em viewport mobile (390×844) e analisei seção por seção:

**Página de Cliente (`/rafael-ferreira`)**
- Botão "Falar no WhatsApp" na navbar ocupa ~65% da largura; logo parece pequena ao lado.
- Subtítulo do hero está em `text-base` mas o card containers depois usam padding e fontes grandes que parecem desproporcionais.
- Cards de vantagens (`AdvantagesSection`) usam padding/altura excessivos, deixando muito texto centralizado em telas de 360-390px.
- Títulos de seção ("Acesso gratuito ao iGreen Club", "Depoimentos", "Conheça nosso consultor") quebram em 2-3 linhas com tamanho gigante (`text-4xl/5xl`) que não escala bem.
- Cookie banner ocupa ~25% da tela e sobrepõe os CTAs do final do hero — visualmente quebra a página em qualquer scroll.

**Página de Licenciado (`/licenciado/rafael-ferreira`)**
- Mesmo problema de navbar (botão "Quero ser Licenciado" enorme).
- Hero tem H1 em `text-[2.1rem]` que ainda vaza em telas 360px ("comissões vitalícias" ocupa linha inteira sozinho).
- 2 CTAs empilhados em full-width (`btn-cta-lg` + `btn-whatsapp`) — bloco gigante.
- Vídeo `controls` nativos aparecem grandes; player default sem mockup-window em algumas seções.
- Títulos numerados ("5 Conexão Club (Individual)") com `text-4xl` quebram em 3 linhas.
- Mesma cookie banner gigante.

## O que vou ajustar

**1. Navbar (`src/components/common/LandingNav.tsx` + `.btn-cta` no index.css)**
- Reduzir CTA em mobile: padding menor, texto encurtado em <640px (ex.: "WhatsApp" / "Ser Licenciado") via classes responsivas, mantendo texto completo em ≥640px.
- Garantir altura da navbar `h-14` em mobile (em vez de `h-16`).

**2. Hero das duas páginas**
- Cliente: subtítulo `text-sm sm:text-base md:text-lg`; espaçamentos `mt-4 sm:mt-6`.
- Licenciado: H1 `text-[1.65rem] sm:text-4xl md:text-5xl lg:text-[3.5rem]`, remover botão secundário `btn-whatsapp` no mobile (manter só CTA principal), exibir secundário a partir de `sm:`.
- Padding `pt-20 md:pt-28` (menos espaço morto no topo mobile).

**3. Títulos de seção (escala global)**
- Criar utilitário `.section-title` no index.css: `text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black leading-[1.1]`.
- Aplicar em `AdvantagesSection`, `ClubSection`, `HowItWorksSection`, `ReferralSection`, `TestimonialsSection`, `ConsultantSection`, `NewsSection`, `StatesSection` e equivalentes em `licenciada/*`.

**4. Cards**
- Reduzir padding `.premium-card` / `.glass-card` no mobile: `p-4 sm:p-6` em vez de `p-5 sm:p-6`/`p-6 md:p-7`.
- Texto interno: `text-sm sm:text-base` (hoje vem grande por herança).

**5. Botões CTA**
- `.btn-cta-lg`: reduzir mobile `px-6 py-3.5 text-base sm:text-lg sm:px-8 sm:py-4`.
- Conferir que botões largos não ficam `w-full` desnecessariamente.

**6. Vídeo do Licenciado (`LicHeroSection` + Hélio Valgas section)**
- Envolver o `<video>` em `mockup-window` consistente; remover `controls` nativos do hero (já é autoPlay/muted/loop como o Cliente faz) e manter `controls` só nos vídeos institucionais.

**7. Cookie banner (`CookieBanner.tsx`)**
- Compactar versão mobile: padding `p-3`, texto `text-xs`, botões menores `px-3 py-1.5 text-xs`, altura total ≤ ~80px.

**8. QA visual**
- Reabrir `/rafael-ferreira` e `/licenciado/rafael-ferreira` em 360, 390 e 414px após mudanças e capturar 3-4 screenshots por página para validar antes de fechar.

## Detalhes técnicos

- Mudanças concentradas em: `src/index.css` (tokens `.btn-cta-lg`, `.premium-card`, `.glass-card`, `.app-navbar-inner`, novo `.section-title`), `src/components/common/LandingNav.tsx`, `src/components/HeroSection.tsx`, `src/components/licenciada/LicHeroSection.tsx`, demais componentes de seção apenas trocando classes de tamanho do título para `.section-title`.
- Nenhuma alteração de lógica de negócio, dados ou rotas.
- Manter cores/HSL semânticas existentes (sem cores cruas).
- Sem mexer em desktop além do que cascateia naturalmente das classes responsivas (`sm:` em diante preserva o visual atual).

## Fora de escopo

- Reescrever copy ou estrutura de seções.
- Alterar fluxo de cadastro/WhatsApp.
- Mudar paleta ou tema.
