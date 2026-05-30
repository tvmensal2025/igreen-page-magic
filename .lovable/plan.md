## Diagnóstico

A Fernanda Bruna (consultora Evolution, não super admin) já tem row em `whatsapp_instances` (criada por um clique anterior em "Conectar"), porém o WhatsApp **não está conectado** — header mostra "WhatsApp Conectando..." e a faixa "Reconectando". PRECISA ABRIR O QRCODE PARA ELA CONECTAR

Com a correção anterior, o gate da aba Conversas é:

```tsx
hasInstance ? <ChatHistory + faixa Reconectar/> : <ConnectionPanel + QR/>
```

Como `hasInstance === true`, ela cai no ChatHistory e **nunca vê o QR Code**, mesmo clicando em "Reconectar" (esse botão só dispara `createAndConnect()` em segundo plano, sem trocar a UI).

## Correção (cirúrgica, só UI)

Em `src/components/whatsapp/WhatsAppTab.tsx`, mudar o gate da aba `conversas` para:

```tsx
(isWhapi || (hasInstance && isConnected)) ? <ChatHistory/> : <ConnectionPanel/>
```

Regra:

- **Super admin (Whapi)**: sempre ChatHistory (nunca QR Evolution).
- **Evolution conectado**: ChatHistory normal.
- **Evolution desconectado/conectando** (tendo ou não row em `whatsapp_instances`): mostra `ConnectionPanel` com o QR Code / botão Conectar.

Sem mudanças no hook `useWhatsApp`, no Whapi, no banco ou nas edge functions.

## Validação

1. Fernanda Bruna (estado atual): aba **Conversas** passa a mostrar o `ConnectionPanel` com o QR.
2. Consultor já conectado: continua vendo o histórico normalmente.
3. Super admin: continua no ChatHistory direto, sem QR.
4. Após escanear o QR e ficar `connected`, o gate troca automaticamente para o ChatHistory.