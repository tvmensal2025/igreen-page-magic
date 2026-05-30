## Diagnóstico

Para um consultor novo (Evolution, ou seja, todos exceto o super admin), a aba **Conversas** nunca mostra o `ConnectionPanel` com o QR Code. Em vez disso ela já abre a UI vazia de chat com a faixa "Desconectado — histórico disponível".

Causa raiz em `src/hooks/useWhatsApp.ts` → `init()` (linha 632):

```ts
const name = getFixedInstanceName(consultantId);
setInstanceName(name); // setado SEM checar se existe row em whatsapp_instances
```

O `instanceName` passa a ter valor mesmo quando não existe nenhuma instância gravada no banco. Em `src/components/whatsapp/WhatsAppTab.tsx` (linha 241) o gate é:

```tsx
instanceName ? <ChatHistory/> : <ConnectionPanel/>
```

Ou seja, como `instanceName` já é truthy, o componente nunca cai no ramo do `ConnectionPanel`/QR. O usuário só vê a faixa de aviso, sem botão grande de "Conectar Evolution" nem QR.

## Correção (cirúrgica, sem mexer no super admin / Whapi)

### 1) Expor `hasInstance` no hook `useWhatsApp`

Em `src/hooks/useWhatsApp.ts`:

- Adicionar estado `const [hasInstance, setHasInstance] = useState(false);`.
- Em `init()`, após o lookup em `whatsapp_instances`:
  - `setHasInstance(!!instanceRecord);`
  - Quando `isSuperAdmin === true` (Whapi), `setHasInstance(true)` (super admin sempre tem "instância" Whapi e não deve ver o QR Evolution).
- Em `createAndConnect()` (após criar a row), e em `markConnected`, garantir `setHasInstance(true)`.
- Em `disconnect()` / `safeReset()` que deletam a row, `setHasInstance(false)`.
- Acrescentar `hasInstance: boolean` na interface `UseWhatsAppReturn` e retornar no objeto final.

### 2) Trocar o gate em `WhatsAppTab.tsx`

`src/components/whatsapp/WhatsAppTab.tsx`:

- Desestruturar `hasInstance` de `useWhatsApp`.
- Linha 241: trocar `instanceName ? (...) : (<ConnectionPanel/>)` por `hasInstance ? (...) : (<ConnectionPanel/>)`.
- Não muda mais nada na lógica de chat — o `instanceName` segue sendo passado para os componentes filhos como hoje.

### 3) Pequeno ajuste UX no header

No header compacto (linha 187), manter o link "Conectar" porém só fazer `setActiveSubTab("conversas")` (que agora vai mostrar o ConnectionPanel/QR). Não chamar `createAndConnect()` direto ali — o usuário clica "Conectar" dentro do `ConnectionPanel`, evitando criar instância acidentalmente.

## Validação

1. Criar/entrar com um consultor novo (Evolution).
2. Abrir aba WhatsApp → aba **Conversas**: deve aparecer o `ConnectionPanel` com botão **Conectar WhatsApp** (Evolution) e, ao clicar, o QR Code.
3. Após escanear → ChatHistory aparece (porque agora existe row em `whatsapp_instances` → `hasInstance=true`).
4. Regressão super admin (rafael.ids@icloud.com): continua mostrando "WhatsApp Conectado" e o ChatHistory direto, **sem** o QR Evolution.
5. Regressão consultor já conectado: continua entrando no ChatHistory normalmente.

## Fora de escopo

- Não mexer no fluxo Whapi do super admin.
- Não mexer em hooks de mensagens/contatos (`useMessages`, `useChats`).
- Não alterar tabelas nem políticas RLS.
- Não tocar nos webhooks/edge functions.
