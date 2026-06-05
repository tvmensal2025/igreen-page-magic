# Auditoria — por que não baixou clientes nem rede

## O que encontrei no código atual

### 1. Salvar credenciais só dispara sync de CLIENTES (não a rede)

`src/components/admin/DashboardTab.tsx` → `handleSaveCredentialsAndSync` (linha 174) e `runSync` (linha 158) chamam `sync-igreen-customers` **sem `mode`**, ou seja, modo "clientes". A função tem dois modos:

- default → `/customer-map/{id}` (clientes)
- `mode: "sync_network"` → `/network-map` (rede)

A rede só é puxada quando o usuário entra na aba **Rede** e clica em "Sincronizar" (`NetworkPanel.tsx` linha 572). Por isso, no fluxo "conectei email/senha", a rede simplesmente nunca é chamada.

### 2. Sync de clientes do `tvmensal01` não rodou com sucesso

Banco confirma:
- `tvmensal01` (consultor `953f7e48…`): tem email + senha salvos, **3 clientes**, **0 membros de rede**, nenhum com `customer_origin='igreen_sync'`.
- `Rafael Ferreira` (já com sync funcional): 993 clientes, 56 membros.

Sem logs recentes da função `sync-igreen-customers` no Edge Logs → a chamada ou nunca chegou ao backend, ou falhou no login do portal (`api-voffice.igreenenergy.com.br/v1/login`) e o erro virou um toast genérico.

### 3. Mensagens de erro mascaradas

A função retorna `{ success:false, error:"Login falhou" }` mas o frontend mostra "Erro desconhecido" em vários caminhos, e nunca exibe o status HTTP nem o corpo da resposta do portal iGreen — impossível para o usuário saber se foi senha errada, 429 (rate limit) ou token ausente.

---

# Plano de correção

## A. `sync-igreen-customers/index.ts` — diagnóstico melhor
- No retorno de `syncOneConsultant`, incluir `login_status` (HTTP code) e `login_body` (primeiros 200 chars) quando o login falhar, para que o toast mostre a causa real.
- Quando login retornar 401/403, devolver mensagem clara: "Email ou senha do portal incorretos" em vez de "Login falhou".
- Quando for 429, devolver "Portal iGreen bloqueou temporariamente — tente novamente em 1 minuto".

## B. `DashboardTab.tsx` — sync unificado ao salvar credenciais
- Trocar `handleSaveCredentialsAndSync` para chamar a função **duas vezes em sequência**: primeiro `mode: undefined` (clientes), depois `mode: "sync_network"` (rede), com 3s de intervalo para evitar rate-limit.
- Trocar `runSync` (botão "Sincronizar" do dashboard) para o mesmo fluxo combinado.
- Toast unificado: "✅ X clientes e Y membros da rede sincronizados".
- Em caso de erro, exibir o `data.error` real (não só "Erro desconhecido").

## C. `NetworkPanel.tsx` — alinhar com o mesmo padrão
- O botão Sincronizar da rede continua chamando só `mode:"sync_network"` (rápido), mas passa a exibir `data.error` real quando falhar.

## D. Validação
- Após o deploy, rodar manualmente o sync do consultor `tvmensal01` pelo painel e ver no Edge Logs:
  - Se aparecer "Login failed for …: 401" → senha realmente errada (orientar o usuário).
  - Se aparecer 429 → ajustar throttle.
  - Se aparecer "Login OK" + clientes baixados → confirma fix.

## Fora de escopo
- Não mexer no cron mode (`source:"cron"`) — está funcionando para o Rafael.
- Não mexer no schema do banco — `network_members`/`customers` já estão corretos.
- Não criar novo botão na UI — só corrigir os dois fluxos existentes.

## Arquivos tocados
- `supabase/functions/sync-igreen-customers/index.ts` (mensagens de erro)
- `src/components/admin/DashboardTab.tsx` (sync combinado clientes+rede)
- `src/components/admin/NetworkPanel.tsx` (surfaçar erro real)
