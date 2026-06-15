# Métricas úteis no header do Fluxo B (IA Livre)

## Problema
No `/admin/fluxos`, quando a variante selecionada é **B (IA Livre)**, o header mostra `0 passos` — informação inútil, porque o Fluxo B não roda no motor de passos. Quem dirige a conversa é o super prompt + a base de conhecimento (RAG).

## O que vai mudar
Apenas o **header da página de fluxos**, dentro de `src/pages/FluxoBuilder.tsx` (linhas ~207-220, onde fica o `Badge "{steps.length} passos"`).

Comportamento por variante:

- **Fluxo D (e outras com passos)**: mantém o badge atual `X passos`.
- **Fluxo B (IA Livre)**: substitui por um conjunto de 3 indicadores compactos + 2 atalhos:
  - `IA Livre` (badge identificador, sem contagem de passos)
  - `Prompt: N chars` — tamanho do super prompt salvo no consultor (`consultants.ai_persona_fluxo_b`)
  - `RAG: N trechos` — contagem em `ai_knowledge_sections` ativos
  - Botão `Editar persona` → rola para o card do Super Prompt já existente abaixo
  - Botão `Conhecimento` → navega para `/admin?tab=conhecimento`

Se o prompt estiver vazio ou o RAG zerado, o indicador fica **âmbar** com tooltip explicando o que falta — assim o usuário vê de relance se a IA está pronta pra operar.

## Detalhes técnicos

Arquivos:
- `src/pages/FluxoBuilder.tsx` — render condicional do header por `editingVariant`.
- Novo componente: `src/components/admin/flow-builder/FluxoBHeaderStats.tsx` — encapsula as 3 métricas + atalhos, faz 2 selects leves (prompt do consultor logado e `count` do RAG).

Dados (sem migrations, sem mudar edge functions):
- `consultants.ai_persona_fluxo_b` (já existe, usado pelo `FluxoBEditor`).
- `ai_knowledge_sections` filtrando ativos (`select id, count: 'exact', head: true`).

Sem alteração no Fluxo D, no roteador de variantes, no `fluxo-b-ai` ou no painel `/admin?tab=fluxo-b`.

## Diagrama do header

```text
Variante D                                 Variante B (IA Livre)
┌──────────────────────────┐   →    ┌──────────────────────────────────────────────┐
│ [D] Fluxo Botões · 12pa. │        │ [B] IA Livre · Prompt 1.8k · RAG 14 trechos │
└──────────────────────────┘        │            [Editar persona] [Conhecimento]   │
                                    └──────────────────────────────────────────────┘
```

## Fora de escopo
- Mudar a aba `/admin?tab=fluxo-b` (Painel da IA).
- Toggle de distribuição por consultor (já feito).
- Qualquer lógica do agente / RAG / edge function.
