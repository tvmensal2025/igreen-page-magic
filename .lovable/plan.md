## O que você pediu

1. **Recolher a ficha lateral direita** (aquela coluna de 340px com "Nome completo / WhatsApp / Documentos / Boleto…") sempre que quiser mais espaço para a conversa.
2. **Separação da lista de leads** em blocos tipo "Em atendimento", "Em espera", "Novos" — do jeito que empresas de atendimento (Intercom, Zendesk, HubSpot Inbox, RD Station) organizam.
3. **Botão "Encerrar captação" em TODO lead**, não só nos "prontos". Hoje aparece só no cabeçalho do chat WhatsApp e no rodapé como "Cadastrar mesmo assim" (que envia pro portal). Você quer o botão de **fechar a captação e ir pra Vendas/Comissão** disponível sempre, em cada lead da Captação.

---

## Como vou fazer

### 1. Ficha lateral recolhível (Cockpit desktop)

Arquivo: `src/components/captacao/CaptacaoPanel.tsx` (linhas ~387-392, o bloco `<div className="hidden lg:flex lg:w-[340px]…">`).

- Adicionar estado `fichaCollapsed` persistido em `localStorage` (`cap_ficha_collapsed`).
- Quando **expandida** (padrão): coluna 340px como hoje, com um botão `»` no topo pra recolher.
- Quando **recolhida**: vira uma faixa vertical de ~40px encostada na direita, com ícone `ClipboardCheck` + contador "3/19" e um botão `«` pra expandir. A conversa ganha os 300px extras.
- Botão também vai no sub-header do Cockpit (ao lado de "Ficha" mobile), pra alternar rápido em desktop.

Padrão que grandes usam: Intercom/HubSpot fazem exatamente isso — sidebar direita colapsa em faixa fina mantendo ícones-chave.

### 2. Lista de leads agrupada por estado de atendimento

Arquivo: `src/components/captacao/CaptureLeadList.tsx`.

Hoje é uma lista plana ordenada por âncora temporal. Vou agrupar em 3 seções colapsáveis (dentro do mesmo filtro de período), com contador em cada:

```text
▾ Em atendimento (5)     ← welcome_sent_at != null && attendance_rating == null && !capture_closed_at
   • Ana Júlia · há 3min
   • Meire · há 8min
▾ Em espera (12)         ← welcome_sent_at == null (ainda não iniciou atendimento)
   • ...
▸ Finalizados (3)        ← capture_closed_at != null OU attendance_rating != null
```

- Cada seção com header cinza discreto: nome + contador + chevron.
- Estado aberto/fechado por seção salvo em `localStorage` (`cap_group_<key>`).
- "Finalizados" começa **fechado** por padrão (some do caminho sem sumir do histórico).
- Ordem dentro de cada seção mantém a lógica atual (mais recente primeiro).
- Precisa incluir `attendance_rating` e `capture_closed_at` no `select` da lista (colunas já existem no schema; se `capture_closed_at` não existir para algum lead antigo, cai em `Em atendimento`/`Em espera` normalmente).

Isso resolve o "não misturar quem estou atendendo agora com quem tá parado esperando" — inspirado no **Intercom Inbox** (Open/Snoozed/Closed) e **HubSpot Conversations** (Unassigned/Assigned/Closed).

### 3. Botão "Encerrar captação" em todo lead

Arquivo: `src/components/captacao/FinalizeButton.tsx` + `CaptacaoPanel.tsx` (rodapé da ficha, via `fichaFooter`).

Hoje o rodapé mostra só o `FinalizeButton` (envia pro portal iGreen). Vou:

- **Manter** o `FinalizeButton` como está (envio ao portal / "Cadastrar mesmo assim").
- **Adicionar** um segundo botão logo abaixo/acima: `Encerrar captação` (variante outline, ícone `ClipboardCheck`), sempre visível **até que `capture_closed_at` esteja preenchido**. Depois some (com selo "Captação encerrada em 10/07").
- Ao clicar → dialog de confirmação → chama a mesma edge `close-capture-and-register-sale` já usada no header do chat (mesma função, mesma lógica: sai da captação, vai pra Vendas/CRM/Comissão, chat WhatsApp continua vivo).
- Após sucesso, muda `selectedId = null` e a lista realtime tira o lead da seção ativa.

Assim o botão fica **em cada lead** (não depende de estar "pronto"), você pode encerrar mesmo faltando dados — igual você já pode com "Cadastrar mesmo assim".

---

## Escopo

- Só front-end/UX. Nenhuma migration, nenhum edge function novo. A `close-capture-and-register-sale` já existe e funciona.
- Sem mexer na lógica de bot, envio, portal ou comissão.
- Arquivos tocados: `CaptacaoPanel.tsx`, `CaptureLeadList.tsx`, `FinalizeButton.tsx` (ou um `CloseCaptureButton.tsx` novo separado pra não misturar responsabilidades — prefiro esse, mais limpo).

## Detalhes técnicos

- **Ficha recolhível**: hook `useLocalStorageState<boolean>("cap_ficha_collapsed", false)`. Largura via classe condicional `lg:w-[40px]` vs `lg:w-[340px]`, com `transition-[width]`. Conteúdo interno renderizado só quando expandida (perf).
- **Agrupamento**: `useMemo` sobre `leads`, retorna `{ atendimento: [], espera: [], finalizados: [] }`. Header component reutilizado por seção. Zero query extra — usa colunas já buscadas + as duas novas no select.
- **CloseCaptureButton**: componente enxuto (~50 linhas) — dialog + `supabase.functions.invoke("close-capture-and-register-sale")` + toast + callback `onClosed` que reseta a seleção no painel pai.
