# Plano — Painel da IA + Toggle de Variante

Dois entregáveis frontend, sem mexer em lógica de bot/edge.

---

## 1. Painel da IA (`/admin?tab=fluxo-b`)

Reescrever `src/pages/AdminFluxoB.tsx` (hoje editor de passos estilo Fluxo D) como painel com 3 abas usando `Tabs` shadcn.

### Aba 1 — Persona
- Editor de texto livre (Textarea grande) com a persona da IA: nome, tom, regras, objetivos, marcadores `[PEDIR_FOTO_CONTA]` / `[FINALIZAR_CADASTRO]`.
- Persistir em `app_settings` (chave `fluxo_b_persona`) — não em arquivo, para editar sem deploy.
- Edge `fluxo-b-ai` passa a ler `app_settings.fluxo_b_persona` em runtime, com fallback para o `persona.ts` atual.
- Botão "Salvar" + "Restaurar padrão".

### Aba 2 — Conhecimento (RAG)
- CRUD da tabela existente `ai_knowledge_sections` (título, conteúdo, tags, ativo).
- Lista + busca + editor inline + botão "Testar busca" (campo de pergunta → mostra top-3 trechos com score).
- Já existe `src/pages/AdminKnowledge.tsx` — verificar se reaproveitamos como subcomponente ou se duplicamos escopo (provavelmente embutir como `<KnowledgePanel scope="fluxo-b" />`).

### Aba 3 — Simulador
- Chat simples (input + histórico) que chama `POST /fluxo-b-ai` com `dryRun: true` e um `leadId` de teste fixo (o `11111111-...` do Rafael).
- Mostra: resposta da IA, marcadores detectados, trechos de conhecimento usados, custo/tokens.
- Botão "Resetar conversa de teste".

---

## 2. Toggle de Variante no Painel do Consultor

Em `src/pages/ConsultantPage.tsx`, adicionar card "Distribuição de Fluxo":
- 3 opções (RadioGroup): **Só Fluxo D (botões)**, **Só Fluxo B (IA)**, **Ambos (A/B 50/50)**.
- Lê/grava `consultants.active_variants` (array `text[]` já usado pelo roteador `assign_flow_variant`).
  - Só D → `['D']`
  - Só B → `['B']`
  - Ambos → `['B','D']`
- Mostrar contador atual (quantos leads em cada variante nos últimos 7 dias) via `customers.flow_variant`.

---

## Detalhes técnicos

- Schema: nenhuma migration nova. Reutilizar `app_settings`, `ai_knowledge_sections`, `consultants.active_variants`, `customers.flow_variant`.
- Edge `fluxo-b-ai`: pequena alteração para ler persona do `app_settings` (fallback no arquivo).
- Componentes shadcn: `Tabs`, `Textarea`, `RadioGroup`, `Card`, `Button`, `Input`, `Badge`.
- Sem alteração no Fluxo D, no webhook, ou no roteador.

---

## Ordem de execução
1. Painel IA — Aba Persona (+ ajuste no edge para ler `app_settings`).
2. Painel IA — Aba Conhecimento.
3. Painel IA — Aba Simulador.
4. Toggle de variante no `ConsultantPage`.

Cada passo é testável isoladamente no preview.
