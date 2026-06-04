# Correções na landing page pública

## Problemas identificados

1. **Link "Página de Cliente" do Admin não abre** — `PreviewTab` usa `baseUrl="igreen.institutodossonhos.com.br"` (domínio que não responde). O domínio real é `igreen.cloud` (visto no print).
2. **Título gigante no mobile** — `HeroSection` usa `text-[2.2rem]` (~35px) com `font-black` e `max-width: 18ch`, fazendo cada palavra quebrar em uma linha. Precisa cair para ~`1.6rem` no mobile.
3. **Vídeo está abaixo do título** — usuário quer o vídeo no topo da Hero, logo após a nav, com autoplay funcionando.

## Mudanças

### 1. `src/pages/Admin.tsx`
- Trocar `const baseUrl = "igreen.institutodossonhos.com.br"` por `"igreen.cloud"`.

### 2. `src/components/HeroSection.tsx`
- Reordenar Hero: **nav → vídeo → badge → título → subtítulo → CTAs → social proof**.
- Reduzir tipografia do `h1` no mobile: `text-[1.65rem] sm:text-4xl md:text-5xl lg:text-[3.5rem]`, aumentar `max-width` para `20ch` para evitar quebra palavra-a-palavra.
- Garantir vídeo funcionando: manter `autoPlay muted playsInline loop`, adicionar `preload="metadata"` e `poster` (frame inicial) para não ficar preto enquanto carrega.
- Reduzir `pt` da seção (vídeo no topo precisa menos respiro): `pt-24 md:pt-28`.

### 3. Validação
- Após edição, abrir o preview em viewport mobile (375px) via browser tool e confirmar:
  - vídeo renderiza acima do título e dá play sozinho,
  - título cabe em ~3 linhas sem palavra solta,
  - link "Página de Cliente" do Admin abre `https://igreen.cloud/<slug>`.

## Fora de escopo
- Não mexer no fluxo de Central de Anúncios nem em edge functions.
- Não trocar o vídeo em si (`/videos/Green_Energy.mp4`).
