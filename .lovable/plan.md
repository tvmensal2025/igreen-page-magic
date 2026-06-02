## O que vou fazer

Travar o banner (parceiro e meu link pessoal) **exatamente** nos valores do print:
- QR vertical: **87%**
- QR horizontal: **20%**
- Tamanho do QR: **30%**
- Rodapé vertical: **99%**
- Faixa mostrar nome/ID/WhatsApp: **ligada**

Os controles ficam visíveis mas **desabilitados** com um pequeno ícone de cadeado 🔒 ao lado do label "Formato do template", explicando que o layout está travado pra garantir que o impresso bata 1:1 com o preview.

### Arquivos

**1) `src/components/admin/parceiros/PartnerQrCode.tsx`**
- Atualizar `TEMPLATES.banner` pros valores travados: `qrX:20, qrY:87, qrSize:30, footerY:99`.
- Adicionar constante `LOCKED_TEMPLATES = { banner: true, a4: false }` (a4 segue editável; só o banner precisa bater impressão).
- Quando travado:
  - Desabilitar drag do QR e do rodapé (early-return em `handlePointerDown` e cursor `default`).
  - Desabilitar os 4 sliders (`disabled` prop) e o checkbox "Mostrar faixa".
  - Desabilitar botões "Enviar imagem" / "Usar template padrão" / "Remover" (mantém arte oficial).
  - Mostrar badge `🔒 Layout travado — bate 1:1 com a impressão` logo abaixo do seletor de formato.
- A4 continua 100% editável como hoje.

**2) `src/components/admin/PanfletoModal.tsx`**
- Esse modal já não tem sliders (posição é fixa em `BANNER_QR_BOX`). Só adicionar o mesmo badge `🔒 Layout travado` no formato banner, pra UX consistente com o do parceiro.
- Confirmar que `BANNER_QR_BOX` corresponde aos mesmos 20%/87%/30% do PartnerQrCode (banner 1008×1880):
  - 20% de 1008 = 201,6 (centro X) → `x = 201,6 - 151,2 = 50,4` ✅ atual está em `x:60` — vou ajustar pra `x:50, y:1373, size:302` (87% de 1880 = 1635,6 centro; size 30% de 1008 = 302,4; `y = 1635,6 - 151,2 = 1484,4`). Refinando: `BANNER_QR_BOX = { x: 50, y: 1484, size: 302 }`.

### Resultado

- Banner no card do parceiro e no "Meu link" sai **idêntico** ao print enviado, sem o usuário conseguir mexer e quebrar o layout.
- Cadeado 🔒 visível pra deixar claro que é proposital (não é bug).
- Sulfite A4 segue 100% editável.

Posso aplicar?
