## Diagnóstico — o que ainda falta no hub

Fiz uma varredura completa nas 180+ tabelas e cruzei com o que já está em `AgendamentosTextosDialog.tsx`. Hoje o hub cobre 11 fontes (catálogo fixo + fluxos + FAQ + voz + chat + bulk + agenda + pós-venda + cadência + reaquecimento + frases de conversão).

**Ainda ficam de fora 6 fontes que o sistema realmente usa para falar com o cliente ou o parceiro** — e algumas coisas que não são texto, mas o usuário pediu "agendar":

| # | Fonte | Onde é usado | Volume | Prioridade |
|---|---|---|---|---|
| 1 | `stage_auto_messages` | Mensagem automática disparada quando o CRM muda de estágio (além do pós-venda que já está no hub) | ~várias por consultor | **Alta** |
| 2 | `ai_knowledge_sections` | Base de conhecimento (RAG) que a IA vendedora usa para responder objeções, preço, garantia | 13 colunas / seções | **Alta** |
| 3 | `ai_agent_config` (`system_prompt`, `step_prompts`) | Personalidade + instruções do agente IA por consultor | 1 por consultor | **Alta** |
| 4 | `voice_templates` + `voice_template_blocks` | Templates de voz reutilizáveis (não só o texto embutido na campanha) | 10 + 8 colunas | Média |
| 5 | `rodizio_pools.message` | Texto do alerta enviado ao parceiro quando ele recebe um lead do rodízio | 17 colunas | Média |
| 6 | `pos_venda_default_media.message_text` | Mídias padrão globais do pós-venda (caption/legenda) | 7 colunas | Baixa |

**Agendamentos** (o "quando", não o "o quê"):
- `holidays` — feriados/quiet-hours que o motor respeita → hoje só via SQL. Adicionar aba "Calendário" com CRUD.
- `reactivation_settings` — janela horária + dias de espera do reaquecimento → hoje só em `/admin/reaquecimento`. Trazer atalho editável na aba Reaquecimento.
- `retention_settings` — quantos dias guardar histórico antes de arquivar → hoje só via SQL. Adicionar na aba "Configurações".

## O que muda

### Novas abas em `AgendamentosTextosDialog.tsx`

1. **CRM automático** — lista `stage_auto_messages` (todos os estágios, não só pós-venda), edição inline de `message_text` + toggle `auto_message_enabled`.
2. **IA — Conhecimento** — CRUD de `ai_knowledge_sections` (título + conteúdo + tags), busca por seção.
3. **IA — Personalidade** — editor de `system_prompt` e `step_prompts` (JSON amigável, um textarea por passo) de `ai_agent_config`.
4. **Voz — Templates** — lista `voice_templates` + blocos, edição do texto de cada bloco.
5. **Rodízio** — edição do `message` de cada `rodizio_pool` (o texto que o parceiro recebe).
6. **Pós-venda global** — edição de `pos_venda_default_media.message_text` (caption das mídias padrão).
7. **Calendário** — CRUD simples de `holidays` (data, nome, tipo). Motor de cadência e crons de envio já respeitam essa tabela.

### Ajustes no catálogo (`src/lib/agendamentosTextosCatalog.ts`)
- Expandir `TextoFonte` com: `stage_auto_messages`, `ai_knowledge_sections`, `ai_agent_config`, `voice_templates`, `rodizio_pools`, `pos_venda_default_media`, `holidays`.
- Adicionar 7 itens novos no catálogo apontando para as abas correspondentes.
- Header do hub passa a mostrar: **"18 fontes editáveis — 100% do que a plataforma envia + calendário"**.

### Escopo/segurança
- Tudo continua com `.eq("consultant_id", consultantId)` (ou global quando fizer sentido, como `holidays` e `ai_knowledge_sections` que são compartilhadas).
- Nada de mexer em RLS existente.
- Sem novas migrations, sem edge functions novas.

## Fora do escopo
- Editor visual de fluxos (permanece em `/admin/fluxos`).
- Criar novos passos/campanhas — o hub só edita o que já existe.
- Mudanças no motor de cadência ou nos crons.

## Arquivos envolvidos
- `src/components/whatsapp/AgendamentosTextosDialog.tsx` — 7 novas abas + loaders + savers.
- `src/lib/agendamentosTextosCatalog.ts` — expandir `TextoFonte`, adicionar 7 itens novos.
