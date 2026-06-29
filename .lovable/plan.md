## Objetivo

Separar visualmente os leads que **já receberam mensagem** dos leads **ainda não contactados**, e trocar termos técnicos confusos ("Cockpit", "Ads/B2B", "CTWA", "Lead Ads") por linguagem simples.

---

## 1. Separação "já conversados" → painel lateral

No `CapturedLeadsPanel.tsx` hoje os leads já enviados ficam misturados na mesma tabela, apenas esmaecidos e com o filtro "Ocultar já enviados". Vamos reorganizar:

- **Lista principal (centro)** mostra **apenas leads ainda não disparados**. Some automaticamente da lista assim que o disparo é concluído (já marcado em `sentPhones`).
- **Painel lateral colapsável à direita** ("Já conversados") — drawer/aside fixo com:
  - contador no topo (ex.: "128 já conversados");
  - busca rápida por nome/telefone;
  - cada item em formato compacto (avatar + nome + canal + data do envio);
  - botão "Reabrir conversa" → abre o cliente no chat.
- Remover o filtro "Ocultar já enviados" e o checkbox associado — passa a ser comportamento padrão.
- Manter o badge "Já enviado" só dentro do painel lateral.

No mobile, o painel lateral vira um botão flutuante "Já conversados (N)" que abre como Sheet de baixo.

## 2. Linguagem clara — remover jargão

Substituições em `CaptacaoPanel.tsx`, `CapturedLeadsPanel.tsx` e diálogos relacionados:

| Atual | Novo |
|---|---|
| Cockpit de captação | Cadastrar lead |
| Leads captados (Ads/B2B) | Lista de leads |
| Meta Lead Ads | Anúncio Facebook/Instagram |
| Click-to-WhatsApp / CTWA | Veio do anúncio |
| Pesquisa B2B | Empresas pesquisadas |
| TikTok Lead Gen | Anúncio TikTok |
| Landing page | Site / Página |
| "Sincronizar WhatsApp" (badge) | "Buscar novos do WhatsApp" |
| Banner "lead(s) do WhatsApp ainda não estão aqui" | "Temos N novos contatos do WhatsApp esperando. Clique para trazer pra cá." |
| Disparo PRO / anti-ban | "Envio em massa (com segurança)" |

Também limpar o subtítulo do painel: tirar "no total / visíveis / selecionados" embolado e usar três chips simples ("Novos: X" · "Selecionados: Y" · "Já conversados: Z" — esse último vira o botão que abre o lateral).

## 3. Arquivos afetados

```text
src/components/captacao/CapturedLeadsPanel.tsx   (split lista + sidebar, novos rótulos)
src/components/captacao/CaptacaoPanel.tsx        (renomear abas)
src/components/captacao/BusinessResearchDialog.tsx (substituir "B2B" no título/descrição)
```

Nenhuma alteração de banco, edge function ou tipos. Só UI/copy.

## 4. Validação

- Disparar para 1 lead → ele sai da lista principal e aparece no painel lateral imediatamente.
- Recarregar a página → o lead continua no lateral (vem de `listAlreadyDispatchedPhones`).
- Conferir mobile: painel lateral acessível via botão.
- Buscar pelo nome no campo principal não traz leads do lateral (evita misturar).
