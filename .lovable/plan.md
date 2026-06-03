## Diagnóstico

O anúncio "feio" que você mandou é uma combinação de 3 causas, **só 2 são bug nosso**:


| Sintoma                                                     | Origem                                                                              | Bug nosso?                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| Overlay "14.300 AO NOSSO FAVOR" estilizado em cima do vídeo | Imagem estática enviada como foto do template (banner pronto em `materialsCatalog`) | ❌ Conteúdo, não código               |
| Crop quadrado corta a consultora                            | Meta gera variação 1:1 automática a partir do 4:5                                   | ⚠️ Parcial — depende do que enviamos |
| Copy cortado "Entre em contato com a P..."                  | Primary text genérico, sem hook nos primeiros 40 chars                              | ✅ Sim                                |
| Página "Instituto dos Sonhos" aparece em todo ad            | Página única compartilhada em `platform_facebook_account`                           | ✅ Sim, estrutural                    |
| Sem legenda no vídeo (85% assiste mudo)                     | Pipeline nunca anexa subtitles à Meta                                               | ✅ Sim                                |
| `CreativeOverlay.tsx` existe mas nunca é importado          | Componente órfão                                                                    | ✅ Sim                                |


## Escopo desta entrega

Foco escolhido: **auditar template/copy** + **refazer criativo com legenda e overlay limpo**. A troca de Página é decisão operacional (Meta Business Suite, não código) — vou só preparar o terreno e instruir.

---

## Mudanças

### 1. Legendas automáticas em vídeo (alto impacto)

- Nova edge function `ad-video-captions`:
  - Recebe `video_url`, extrai áudio (ffmpeg via Deno externalProc OU envia direto pro Whisper via Lovable AI Gateway com `audio/*`).
  - Transcreve com `openai/whisper` em pt-BR, retorna SRT.
  - Faz upload do SRT pro bucket `IMAGE` e devolve a URL.
- `facebook-create-campaign` (`object_story_spec` do vídeo) ganha campo `video_captions` que anexa o SRT como caption do creative (Meta API: `creative.video_data.captions_url`).
- `CreateCampaignWizard` Step 2: ao terminar upload do vídeo, dispara `ad-video-captions` em background, mostra "Gerando legendas… (recomendado)" com toggle pra desativar.

### 2. Copy: hook curto + reforço do trigger

- `ad-creative-builder/index.ts`: ajustar prompt e fallback pra que `**primary_text` SEMPRE comece com gancho de ≤40 chars antes do primeiro ponto** (resolve o "Entre em contato com a P…" cortado no feed).
- Adicionar regra: primeira sentence ≤ 40 chars, e descartar variações que comecem com "Entre em contato", "Saiba mais", "Conheça".
- Aumentar `temperature` da 2ª e 3ª variation pra diferenciação real.

### 3. Plugar `CreativeOverlay` como opção de "auto-arte"

- Marcar o componente atual como **legacy** (copy hardcoded de outra marca, R$436,32) e reescrever pra:
  - Receber `headline`, `bullets`, `pctSaving`, `accentColor` por prop (sem strings fixas).
  - Suportar formato 1:1, 4:5, 9:16 (não só fixo).
  - Logo iGreen no canto, safe-area respeitada.
- No Step 2 do wizard: novo botão "Gerar arte com overlay" pra fotos sem tratamento. Roda `html2canvas` no client, sobe via `uploadAdCreativeImage`.
- Não toca em quem já usa imagem pronta (caso da "14.300").

### 4. Aviso sobre Página compartilhada

- Banner no Step 4 do wizard:  
*"Sua campanha vai ao ar na Página **{page_name}**. Para sua marca aparecer, peça ao admin pra conectar uma Página própria em Configurações > Facebook."*
- Em `SuperAdmin > Configurações`, mostrar o `page_name` atual de `platform_facebook_account` + botão "Trocar Página da plataforma" (link pro Business Suite + instruções).

### 5. Limpar pipeline

- Deletar `CreativeOverlay.tsx` antigo se a v2 ficar pronta.
- Remover `image_briefs` da resposta quando o consultor escolhe vídeo (hoje vem entulho).

---

## Arquivos afetados

```text
NOVO  supabase/functions/ad-video-captions/index.ts
EDIT  supabase/functions/facebook-create-campaign/index.ts   (campo video_captions)
EDIT  supabase/functions/ad-creative-builder/index.ts        (regra hook ≤40 chars)
EDIT  src/components/admin/ads/CreateCampaignWizard.tsx       (chamar captions, banner page, botão overlay)
EDIT  src/components/admin/ads/CreativeOverlay.tsx           (reescrever paramétrico)
EDIT  src/components/superadmin/...                          (mostrar page_name + instrução)
```

## Fora de escopo

- Trocar a Página do Facebook (operação em conta Meta, não código).
- Refazer o vídeo da gravação (conteúdo).
- Eliminar a arte "14.300 AO NOSSO FAVOR" — ela vive em `materialsCatalog` como material de venda e foi você (ou outro consultor) que subiu como foto do template. Posso marcá-la como "não recomendado pra ads pagos" se quiser.

## Vai ter conversão?

Estrutura tem todos os ingredientes (oferta clara, prova visual, CTA WhatsApp). O que está derrubando hoje é o **hook cortado** e **vídeo mudo**. Os itens 1 e 2 desse plano normalmente sobem CTR em **30–60%** em campanhas WhatsApp solar. Não dá número garantido, mas estamos saindo de "feio e capado" pra "padrão de mercado".

---

Implante inteiro

&nbsp;