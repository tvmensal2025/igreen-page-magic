## O que precisa mudar

Na barra inferior do painel direito do WhatsApp (CaptureSheet) temos hoje **dois bloqueadores** independentes para o botão verde `CADASTRAR`:

1. `validation.ok` (todos os 18 campos válidos)
2. `allConfirmed` = `billConfirmed && docConfirmed` (consultor clicou "Eu confirmo" nos cards de OCR)

Quando a ficha está **18/18** mas o consultor ainda não clicou nos botões de confirmação dos cards de OCR, o botão fica cinza mostrando `18/18 ·📄` (foi o caso do BRUNO na screenshot). O usuário quer que, com ficha cheia, **o botão SEMPRE esteja liberado** — a confirmação de OCR vira só um aviso, não um bloqueio.

Além disso, o feedback visual de "deu certo" hoje é discreto (toast + banner amarelo→verde do `PortalStatusTracker`). Quer um indicativo claro de sucesso no próprio rodapé.

## Mudanças (somente UI/presentation)

### 1. `src/components/captacao/CaptureSheet.tsx` — destravar CADASTRAR

- `canSubmit` passa a depender só de `validation?.ok` (ficha 18/18).
- Novo flag `hasUnconfirmedOcr = !billConfirmed || !docConfirmed` apenas para mostrar um aviso discreto acima do botão ("⚠️ Conta/Doc sem confirmação — envie mesmo assim?") sem travar o clique.
- Tooltip do botão lista a pendência de confirmação como aviso, não como bloqueio.
- Label do botão: quando `canSubmit && hasUnconfirmedOcr` mostra "CADASTRAR ⚠️" (mesmo estilo verde), quando tudo OK mostra "CADASTRAR 🚀".

### 2. `src/components/captacao/PortalStatusTracker.tsx` — reforçar estado de sucesso

Quando `isDone` (status = `cadastro_concluido` / `registered_igreen`):
- Card maior, com gradiente esmeralda + ícone `CheckCircle2` animado (pulse) e borda glow.
- Título grande "🎉 Cadastro aprovado pela iGreen!" + subtítulo "Código iGreen: XXXX".
- Botão "Copiar código" em destaque.
- Mantém os badges (Extração auto / IA analisou) abaixo.

### 3. `src/components/captacao/CaptureSheet.tsx` — celebração no rodapé

- Quando `customer.status === "registered_igreen"` ou `finalized_at`, esconde o par de botões (Enviar tudo / CADASTRAR) e mostra no lugar um bloco verde "✅ Lead cadastrado — código XXXX" com botão secundário "Abrir novo lead".
- Evita o consultor clicar CADASTRAR de novo num lead já concluído.

### 4. (opcional, mesma tela) micro-polimento

- Texto "Faltam 0 dados 💪" troca para "Ficha completa! 🏆" quando `filledCount === totalFields`.
- Barra de progresso ganha cor esmeralda em 100%.

## O que NÃO muda

- Nada de backend / edge functions / worker.
- `finalize-capture` continua fazendo a validação de servidor (continua sendo a fonte da verdade — se faltar algo crítico, ele rejeita com `incomplete`).
- Cards de OCR (`OcrReviewCard`, `CaptureDataConfirmCard`) continuam funcionando igual; só deixam de bloquear o CADASTRAR no front.

## Observação sobre o login solicitado

Você pediu pra eu entrar com `rafael.ids@icloud.com / 10203040` e olhar a tela ao vivo. Não posso digitar credenciais sem sua autorização explícita dentro do preview, e em plan mode não edito nem executo nada. Já tenho a screenshot e o código, então consigo aplicar o fix direto assim que você aprovar. Se quiser que eu valide visualmente depois, faça o login no preview e eu abro pelo browser do sandbox sem precisar de senha.
