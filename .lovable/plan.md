## Refinar Captação — parity com padrão WhatsApp Business

### Diagnóstico
1. Botão "Agendar ligação" no card é um ícone 24×24 ghost espremido ao lado da barra de progresso — some visualmente.
2. Header do `CaptureSheet` (painel do lead aberto) NÃO tem botão Agendar — só existe no rodapé, embaixo de CADASTRAR/Encerrar. Por isso "aqui dentro não aparece".
3. Nomes ficam estreitos porque a linha divide espaço com timestamp + badge unread + ícone telefone.
4. "Em atendimento" e "Em espera" hoje são acordeões empilhados. Ferramentas do mercado (WhatsApp Business, Kommo, RD) usam abas no topo — o consultor troca entre visões sem rolar.

### O que vou fazer

**1. Abas no topo da lista** — em `CaptureLeadList.tsx`, substituir os 5 acordeões por 2 abas:
- `Em atendimento (N)` — lista plana ordenada por atividade
- `Em espera (N •)` — mantém sub-headers Hoje / Ontem / 7d / Antigos
- Cada aba mostra sua própria bolinha de não-lidas
- Aba selecionada persiste em `localStorage`

```text
Conversas · 165
[buscar…]
┌─────────────┬─────────────────┐
│ Em atend 16 │ Em espera 149 • │
└─────────────┴─────────────────┘
[48h 7d 30d 60d 90d Todos]
```

**2. Botão "Ligar" visível no card** — trocar ícone-only 24×24 por botão pequeno com ícone + texto "Ligar" (`h-6 px-2 text-[10px]`), reposicionado pra linha do timestamp (canto superior direito). Libera a linha da barra de progresso e fica clicável sem hover.

**3. Nome com mais espaço** — remover contador numérico `filled/total` (barra já é o feedback), reduzir gaps internos, subir nome pra `text-[13px] leading-tight`.

**4. Header do `CaptureSheet` ganha atalhos** — ao lado do X de fechar:
- 📞 Ligar → abre dialog de `ScheduleCallButton`
- ▶ Iniciar atendimento → dispara `start-customer-attendance` (só quando `!welcome_sent_at`)
- Botões `h-6 px-2 text-[10px]` variant ghost, sem competir com o CADASTRAR do rodapé.

**5. Não-lidas por aba** — dividir `unreadTotal` global em `unreadEmAtendimento` / `unreadEmEspera` pra pintar a bolinha da aba certa.

### Fora do escopo
- Edge functions, bot, fluxo de mensagens.
- Persistir aba/unread no banco (segue client-side).
- Redesenhar o feed de mensagens (`CaptureConversationFeed`).

### Arquivos afetados
- `src/components/captacao/CaptureLeadList.tsx`
- `src/components/captacao/CaptureSheet.tsx`

### Critérios de aceite
- Header da lista tem 2 abas ("Em atendimento N" / "Em espera N") — clicar troca a view sem misturar.
- Cada aba mostra sua própria contagem de não-lidas.
- Botão "Ligar" visível no canto superior direito de todo card sem depender de hover.
- Nome do lead ocupa pelo menos 60% da largura do card antes de truncar.
- Header do painel do lead aberto (inline) tem "📞 Ligar" e (quando aplicável) "▶ Iniciar atendimento".
