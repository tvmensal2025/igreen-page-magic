## Diagnóstico

O fluxo de aprovação **não está quebrado** — o SuperAdmin lê de `public.consultants` corretamente. O problema é que **não existe registro lá pros consultores que você cadastrou hoje**.

Estado real no banco:

```text
auth.users (3):
  - rafael.ids@icloud.com   (admin, criado em mar/26)
  - tvmensal01@gmail.com    (criado hoje 22:02)
  - tvmensal22@gmail.com    (criado hoje 22:13)

public.consultants (1):
  - rafael (approved=true)
  → tvmensal01 e tvmensal22 NÃO estão aqui
```

Por isso o SuperAdmin não vê ninguém pra aprovar — e como a tela "Aguardando Aprovação" aparece para o consultor (`approved=false`), o `useAdminAuth` tentou criar a linha pendente automaticamente mas **falhou silenciosamente**: o `catch {}` em `src/hooks/useAdminAuth.ts:93` engole qualquer erro do `upsert` sem logar nem avisar — incluindo erros do trigger `trg_seed_camila_flow` que insere em `bot_flows` no AFTER INSERT.

Resultado: o usuário fica preso na tela "Aguardando Aprovação" pra sempre, e o admin nunca recebe nada na fila.

## Plano de correção

### 1. Rede de segurança no banco — trigger `on_auth_user_created`

Criar trigger `AFTER INSERT ON auth.users` que insere automaticamente uma linha pendente em `public.consultants` (com `approved=false`, license única baseada em email+uid). Roda como `SECURITY DEFINER` para bypassar RLS. Esse é o padrão Supabase recomendado e garante que o consultor sempre aparece pro SuperAdmin, independente de onde a UI falhe.

### 2. Backfill dos 2 órfãos

Migration que insere `tvmensal01` e `tvmensal22` em `consultants` com `approved=false`. Após aplicar, eles aparecem no SuperAdmin pra você aprovar/revogar/resetar senha.

### 3. Parar de engolir erro no `useAdminAuth`

Trocar `catch {}` por `catch (e) { console.error + toast }` em `src/hooks/useAdminAuth.ts` linha 93, para que qualquer falha futura no upsert apareça no console e como toast (em vez de deixar o user preso achando que tá tudo certo).

### 4. (Opcional) Ajustar Auth.tsx

Manter o form completo (nome/whatsapp/igreen_id) que adicionei antes, mas tornar o `insert` em consultants **best-effort** — se falhar, o trigger do passo 1 garante a criação mínima. Isso evita ter dois caminhos de criação podendo conflitar pela license única.

## Por que não foi só um signup com email mágico?

Você comentou "antes funcionava". O `useAdminAuth` já tem a lógica de criar pendente no primeiro login (`upsert` com `onConflict:"id"` na linha 91), mas:
- Depende de o user clicar no link de confirmação e abrir `/admin`.
- Não loga falhas, então qualquer constraint nova quebrou silenciosamente.
- Não cria nada se o user ficou na aba de cadastro sem entrar.

O trigger no `auth.users` é determinístico — cria na hora do signup, antes de qualquer navegação.

## Arquivos afetados

- Migration nova: trigger `handle_new_consultant_signup` + backfill dos 2 órfãos.
- `src/hooks/useAdminAuth.ts` (linha 93 — adicionar log + toast no catch).
- `src/pages/Auth.tsx` (tornar insert tolerante a duplicata por causa do trigger).

Nenhuma mudança em SuperAdmin.tsx — ele já funciona, só precisa receber dados.
