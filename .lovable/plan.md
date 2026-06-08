## Objetivo

1. Travar de vez o tamanho/posição do A4 no modal de Panfleto (sem opção de destravar).
2. Reaproveitar esse mesmo modal (Panfleto A4) quando o usuário clicar em "QR Code" nos links pessoais — substituindo o modal simples atual.

## Mudanças

### 1. `src/components/admin/PanfletoModal.tsx`
- Manter os defaults atuais do A4 já travados (`qrX: 25, qrY: 91, qrSize: 18, footerY: 99`) e do banner.
- Remover o botão de Destravar/Travar layout e os sliders de posição (QR vertical/horizontal, tamanho do QR, posição do rodapé). O layout fica fixo nos defaults do template.
- Manter: trocar formato (A4 / Banner), enviar imagem de fundo, toggle "Mostrar faixa", copiar link, Baixar PNG, Baixar PDF.
- Aceitar uma `url` opcional via prop (`shareUrl?: string`) para o QR. Se não vier, segue gerando a URL do link pessoal `https://wa.me/...` como hoje.
- Permitir um `title` opcional (ex.: "QR Code — Horacio (Página inicial)") pra refletir qual link/página o usuário está gerando.

### 2. `src/pages/Admin.tsx`
- Remover o `qrModal` simples (estado + JSX do modal de QR básico).
- Trocar `onQrOpen={(url, label) => setQrModal(...)}` por uma versão que abre o `PanfletoModal` já existente, passando `shareUrl=url` e `title=label`.
- Reusar o mesmo `panfletoOpen` (estendido para guardar `{ url?, label? }`) ou criar `qrPanfletoState` separado — implementação interna.

### 3. `src/components/admin/LinksTab.tsx`
- Sem mudança de contrato. Continua chamando `onQrOpen(fullUrl, label)` em cada link pessoal; quem decide qual modal abrir é o `Admin.tsx`.

## Fora de escopo
- Não mexer em `PartnerQrCode.tsx` (parceiro) — já está travado conforme combinado antes.
- Não alterar lógica de export PDF/PNG nem as dimensões nativas do canvas.
