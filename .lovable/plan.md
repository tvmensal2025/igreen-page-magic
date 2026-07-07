## Objetivo

Você vai cadastrar **2 participantes no rodízio** (2 nomes + 2 telefones) direto no wizard do anúncio. Analisei o fluxo (`RodizioBlock` → `RodizioInlineForm` → `useRodizioLogic` → `referralPartners.ts`) e ele **funciona**, mas tem 5 pontos que geram confusão / erro silencioso quando o parceiro é cadastrado no calor da hora. Vou corrigir tudo em uma única passada, só na camada de UI/validação — sem tocar em regras de rodízio nem em banco.

## O que quebra hoje

1. **Telefone aceita qualquer coisa** — "11 99999-8888", "(11) 99999-8888" ou até "abc" são salvos como estão. Depois o `notifyPartnerNewLead` tenta mandar WhatsApp e falha em silêncio — o parceiro nunca recebe o lead.
2. **Sem checagem de duplicado** — mesmo telefone / mesmo código iGreen / mesmo `cli` em 2 participantes passa. Isso quebra o rodízio (dois "slots" apontam pro mesmo WhatsApp).
3. **Mensagens sem emoji e vagas** — "Informe o telefone de aviso." não diz *pra quê* serve o telefone nem *que formato* usar. Idem "cli é obrigatório" (o usuário não sabe o que é `cli`).
4. **Toast concatena todos os erros numa linha só** (`erros.join(" ")`) — vira um blocão ilegível.
5. **Mapeamento de erro por campo é frágil** — `mapInlineErrors` usa `msg.includes("nome")` etc. Se eu mudar o texto do erro pra ficar mais amigável, o erro deixa de aparecer embaixo do input certo.

## O que vou mudar

Todas as edições ficam em **3 arquivos** — nenhuma migração, nada de rodízio novo:

- `src/services/referralPartners.ts`
- `src/components/admin/ads/campaign-wizard/hooks/useRodizioLogic.ts`
- `src/components/admin/ads/campaign-wizard/RodizioInlineForm.tsx`
- `src/components/admin/ads/campaign-wizard/RodizioBlock.tsx` (só remover o `mapInlineErrors` frágil)

### 1. Validar e normalizar telefone (Brasil)

Em `referralPartners.ts` (e reusar no hook):

- Nova função `normalizeBrPhone(raw)` — tira máscara, aceita 10/11 dígitos (com/sem 9), rejeita repetidos ("11111111111") e devolve `55DDDNNNNNNNNN` (formato que o webhook já usa).
- Retorna `null` se inválido → o hook mostra alerta claro.

### 2. Bloquear duplicado no próprio wizard

No `useRodizioLogic.submitInlineForm`, antes de chamar `createReferralPartner`:

- Checar se o telefone normalizado já existe em `availablePartners` **ou** em `state.rodizioPartners`.
- Checar se `partner_igreen_id` (consultor) ou `cli` (parceiro) já existe.
- Se sim, mostrar alerta específico e **não** cria.

### 3. Reescrever validação com códigos de campo

Trocar `validateInlineForm(): string[]` por:

```ts
type FieldError = { field: 'nome'|'notification_phone'|'partner_igreen_id'|'cli'; message: string };
validateInlineForm(form): FieldError[]
```

Aí `RodizioBlock` deixa de fazer `msg.includes(...)` — pega direto pelo `field`.

### 4. Mensagens novas (com emoji + passo claro)

**Toast de sucesso:**
- `✅ Participante criado` — "Fulano entrou no rodízio. Ele vai receber os avisos no WhatsApp {telefone}."

**Toast de erro (por caso):**
- `⚠️ Confira os campos abaixo` — sem lista concatenada; o próprio form destaca cada campo.
- `📵 Telefone inválido` — "Use DDD + número, ex.: 11 99999-8888. Sem espaços ou traços é ok."
- `♻️ Este telefone já está no rodízio` — "O participante {nome} já usa este WhatsApp. Cada participante precisa de um número diferente."
- `🆔 Código iGreen já cadastrado` — "{nome} já usa este código. Um mesmo consultor não pode aparecer duas vezes."
- `🔢 cli já cadastrado` — mesma ideia para parceiro.
- `❌ Não consegui salvar` — mensagem do backend.

**Erro embaixo do input (menores, direto):**
- Nome: "Digite o nome do participante."
- Telefone: "📱 Ex.: 11 99999-8888 (com DDD)."
- Código iGreen: "🆔 O código iGreen aparece no painel do consultor."
- `cli`: "🔢 Código de indicação (o iGreen chama de `cli`). Peça pro parceiro te passar."

**Aviso do mínimo (banner amarelo):**
- `⚠️ Faltam participantes` — "O rodízio precisa de pelo menos 2 pessoas pra alternar. Adicione mais {n} participante(s) ou desligue o rodízio."

### 5. Melhorias de UX pequenas

- Renomear label `cli` → **"Código de indicação"** (com hint "no iGreen aparece como `cli`") — o campo continua chamado `cli` no banco.
- Placeholder do telefone → `Ex.: 11 99999-8888` (formato que gente entende).
- Hint abaixo do telefone: "Este WhatsApp vai receber uma mensagem cada vez que chegar um lead deste anúncio."
- Botão "Salvar participante" vira `✅ Adicionar ao rodízio`.
- Toast do "já adicionado" ganha emoji: `♻️ Já está no rodízio`.

## Fora de escopo (não vou mexer)

- Regra do rodízio (`rodizio_next`, `rodizio_pools`, atribuição no `evolution-webhook`) — está OK.
- Tabela `referral_partners` (nenhuma migração, nenhum GRANT novo).
- `PartnerRedirectPage`, edge functions, notifications.

## Verificação

- Rodar `tsgo` (typecheck) — só pra pegar o rename de `validateInlineForm`.
- Rodar os testes existentes (`rodizio-*.property.test.ts`, `portal2-payload.property.test.ts`) — não devem quebrar (não tocamos na lógica).

## Resultado esperado

Você cadastra os 2 participantes com 2 telefones diferentes; se digitar telefone bagunçado ou repetir número/código, aparece um alerta claro **com emoji** dizendo exatamente o que corrigir. O parceiro passa a receber a notificação (porque o telefone foi normalizado antes de salvar).
