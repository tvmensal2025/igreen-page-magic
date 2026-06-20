# Deduplicação de mídia (imagens / vídeos / áudios)

Varri `public/` e `src/assets/` com `md5sum` e cruzei com as referências no código. Encontrei **20 grupos de duplicatas exatas** (byte-a-byte) e mais alguns casos próximos. Áudios: só existe `public/audio/vinheta_tenda.mp3` — não há duplicata.

## Resumo do que vou fazer

Para cada grupo de arquivos idênticos: mantenho **1 cópia** (a já referenciada pelo código ou, se nenhuma estiver em uso, a de caminho mais "canônico"/mais curto) e apago as demais, atualizando todas as referências em `src/`, `public/sw.js` e `index.html` para apontarem para a cópia mantida.

Quando os arquivos têm o **mesmo conteúdo mas tamanhos diferentes**, mantenho o **menor** (mais leve) e redireciono referências.

## Grupos a deduplicar

### Vídeos (ganho grande)


| Manter                                                              | Apagar                                                                               | Motivo          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------- |
| `public/videos/Green_Energy.mp4` (10,3 MB, usado no `HeroSection`)  | `public/videos/como-funciona-cliente.mp4` (10,3 MB, **idêntico**, sem referências)   | −10 MB          |
| `public/videos/posters/Green_Energy.webp`                           | `public/videos/posters/como-funciona-cliente.webp` (idêntico, sem ref)               | poster sobrando |
| `public/videos/posters/igreen_club_3.webp` (usado em `ClubSection`) | `public/videos/posters/igreen-club.webp` (idêntico, sem ref)                         | poster sobrando |
| `public/videos/posters/club-de-beneficios.webp`                     | `public/videos/conexao-posters/ce6cb48e-688f-48ba-8e62-a9a96b195e4a.webp` (idêntico) | unificar        |
| `public/videos/posters/depoimento-2.webp`                           | `public/videos/conexao-posters/a6b1844b-7d02-4be5-b5c3-09940812a040.webp` (idêntico) | unificar        |


Obs.: os vídeos `Green_Energy.mp4` e `como-funciona-cliente.mp4` que você editou acabaram **com o mesmo hash e mesmo tamanho** — então não dá pra escolher "o mais leve", são iguais. Vou manter `Green_Energy.mp4` (é o referenciado).

### Logos / banners repetidos por pasta


| Manter                                                             | Apagar                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/images/g-verde.png` (= `src/assets/igreen-logo.png`)       | Trocar `import igreenLogo from "@/assets/igreen-logo.png"` em `AssistentePage.tsx` por `/images/g-verde.png` e remover `src/assets/igreen-logo.png` |
| `public/conexao/shared/Logo-Colorida-iGreen.png` (novo)            | 5 cópias em `conexao-club-pj/`, `conexao-club/`, `conexao-livre/`, `conexao-placas/`, `conexao-solar/` (todas idênticas) — −118 KB                  |
| `public/conexao/shared/screenshot-20250502-174347-502.webp` (novo) | 7 cópias (uma por slug) — **−1,45 MB**                                                                                                              |


Para isso vou ajustar `src/data/conexaoProducts.ts` e o resolver de paths para aceitar caminhos com `/shared/` quando o arquivo for compartilhado.

### Pares `conexao-club` ↔ `conexao-club-pj` (idênticos)

8 arquivos duplicados (`imagem-2`, `imagem-3-cinemark`, `imagem-4-pague-menos`, `imagem-5-dominos-pizza`, `imagem-6-vivara`, `imagem-7-casas-bahia`, `imagem-8-burguer-king`, `imagem-9-drogasil`). Vou mover para `public/conexao/shared/club/` e referenciar de ambos os produtos. **−~430 KB.**

### Pares `conexao-placas` ↔ `conexao-solar` (idênticos)

`celular-igreen.webp` e `feed-10.webp` → mover para `public/conexao/shared/`. **−118 KB.**

### Imagens soltas


| Manter                                                                        | Apagar / redirecionar                                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `public/images/feed-1.jpeg` (usada em `SolarPlantsSection` e em `catalog.ts`) | `public/images/solar-bg.jpg` (idêntico) — trocar referência em `CadastroPage.tsx` e `catalog.ts:378` para `feed-1.jpeg` |


## O que NÃO vou tocar sem sua confirmação

1. `**mutirao-lei-14300*` (5 arquivos, 1,8 MB no total)** — `.jpg`, `.png`, `-base.jpg`, `-parceiro.jpg`, `banner-lei-14300-base.jpg`. Não são duplicatas exatas (conteúdos/recortes diferentes) e **não encontrei referências no código**. Pode ser que sejam usados por download direto/material de marketing.
2. `**public/images/banner-a4.jpg` (1,2 MB), `banner-504x904.jpg` (1,7 MB), `workflows-a4.jpg` (686 KB)** — sem referências no código. Podem ser materiais para download.
3. `**public/images/club-banner-1..7.png` (7 arquivos, ~750 KB)** — usados em `materialsCatalog.ts`; são variações reais, mantenho todos.
4. **Vídeos `depoimento-1..5.mp4` e `igreen-club.mp4` (27 MB!), `igreen-energy.mp4` (13 MB)** — todos referenciados; são conteúdos diferentes, não dedupa.

Se você confirmar, posso numa segunda rodada apagar os arquivos do bloco "NÃO vou tocar" que estiverem realmente sem uso.

## Ganho estimado

- Duplicatas exatas removidas: **~12,3 MB** (10 MB do vídeo + ~2,2 MB de imagens repetidas por pasta).
- Sem mudanças visuais: todas as referências continuam apontando para o mesmo conteúdo.

## Detalhes técnicos

- Atualizações em: `src/pages/AssistentePage.tsx`, `src/pages/CadastroPage.tsx`, `src/features/produtos/orcamento/catalog.ts`, `src/data/conexaoProducts.ts` (+ helper de path para suportar `shared/`).
- Apagar arquivos com `rm`.
- Rodar `bun run build` no fim para garantir que nenhuma referência ficou quebrada.

Posso seguir? SIM, CUIDADO PARA NAO DEIXAR NADA SEM IMAGEM OU VIDEOMOU QUEBRAR ALGO QUE JA ESTEJA FUNCIONANDO