
## Problema

Lead da Damiana (phone 5511989000650) está com TODOS os 18 campos do portal preenchidos no banco (nome, CPF, nascimento, endereço completo, CPFL Paulista, instalação, valor, kWh, doc frente, doc verso, conta de luz), mas a ficha mostra **2/18** e o botão fica `2/18` desabilitado em vez de **CADASTRAR**.

Checando o banco:

```
name: Damiana Nascimento De Souza Silva
cpf: 71678964891
data_nascimento: 16/09/1955
phone: 5511989000650
email: TVMENSAL01           ← ❌ NÃO É E-MAIL VÁLIDO
cep: 13360000
address: R OSVALDO CRUZ, 78, CENTRO, CAPIVARI/SP
distribuidora: CPFL PAULISTA
numero_instalacao: 01000000001
valor: 163.26   kWh: 148
docs: frente ✓ verso ✓ conta ✓
name_mismatch: flag=true, acknowledged ✓
```

Duas causas prováveis (vou confirmar com console no preview antes de aplicar):

### Causa 1 — E-mail `"TVMENSAL01"` invalida o cadastro

O OCR/bot gravou um nome de plano da conta de luz como e-mail. `validateForPortal` marca como `invalid` mas o campo continua "preenchido", então **filledCount deveria** ser 18/18 e o botão deveria aceitar (só fica vermelho com aviso de e-mail). Mesmo assim o lead não pode ir pro portal sem e-mail real.

### Causa 2 — `useCaptureSession` carregando customer errado / desatualizado

A ficha mostrar 2/18 com tudo cheio no banco indica que `captureCustomer` no front está NULL ou é uma versão velha (antes do realtime). Possível: o resolver de `ChatView` (linha ~270) usa `.maybeSingle()` no lookup por phone — se houver mais de uma linha com o mesmo phone+consultant a query erra e cai no fallback fuzzy `.like('%tail').limit(1)` sem `order by`, podendo trazer um shell vazio.

## Plano de correção

### 1. `src/lib/captacao/portalValidation.ts`
- Quando o e-mail está preenchido mas formato inválido, contar como **missing** (não só invalid), pra a UI listar "E-mail" entre as pendências em vez de bloquear silenciosamente o botão. Isso já força o consultor a corrigir o `TVMENSAL01`.

### 2. `src/components/whatsapp/ChatView.tsx` (resolver de customer)
- Trocar `.maybeSingle()` por `.select().order('created_at', { ascending: false }).limit(1).maybeSingle()` filtrando por `customer_origin='whatsapp_lead'`.
- No fallback fuzzy, idem: `order by created_at desc` pra sempre pegar o registro mais recente do mesmo phone (evita carregar um shell antigo).

### 3. `src/hooks/useCaptureSession.ts`
- Logar `customer_id` carregado + `filledCount` em `console.debug` quando `import.meta.env.DEV` — ajuda a confirmar se está realmente lendo a linha certa.
- Garantir que após o `UPDATE` realtime, o `validateForPortal` é re-rodado (já é via `useMemo([customer])`, mas confirmar que o payload tem todos os campos — caso contrário fazer `reload()`).

### 4. `src/components/captacao/CaptureSheet.tsx`
- No bloco "Faltam X dados", mostrar EXATAMENTE a lista `validation.pendingItems` (já existe), e adicionar no botão um tooltip com o primeiro item pendente quando `!canSubmit`, pra o usuário entender o que falta sem ter que abrir a ficha.

### 5. Edge function `finalize-capture`
- Sem mudança — a validação canônica é a mesma do front (`portalValidation.ts` espelhado). Se o front liberar, o portal aceita.

## Verificação

1. Abrir o lead Damiana, abrir DevTools → conferir `console.debug` mostrando `filledCount=17, missing=[email]`.
2. Corrigir e-mail do lead pela ficha → contador vai pra 18/18 e botão vira **CADASTRAR 🚀**.
3. Clicar → `finalize-capture` aceita e dispatcha pro portal.

## Detalhes técnicos

- `validateForPortal` muda só o trecho do e-mail: se `isStrFilled(c.email) && !regex.test(...)`, em vez de só empurrar `invalid`, marcar também como missing (push em `missing` array). Mantém `invalid` pra mensagem de motivo.
- O resolver de `ChatView` precisa lidar com `error.code === 'PGRST116'` (multiple rows) caindo no `order by created_at desc limit 1` em vez de criar um novo customer.
