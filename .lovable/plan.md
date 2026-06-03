# Correção dos achados da auditoria do Fluxo D

Cada passo é alterado isoladamente, por ID. Nenhum UPDATE afeta dois passos.

## Migration única (todas as operações, cada uma num statement próprio)

### A. Desativar 2 passos inalcançáveis

```sql
UPDATE bot_flow_steps SET is_active=false WHERE id='7a85cc99-6fdf-4e5c-8752-d51b92e9bd09'; -- d_handoff
UPDATE bot_flow_steps SET is_active=false WHERE id='dc43c090-62e8-4429-bc7d-d5e2230c2a26'; -- d_como_funciona_copy_in3s
```

### B. Remover `trigger_phrases` curtas (substring-collision)

Phrases-alvo a remover: `"um"`, `"dois"`, `"tres"`, `"três"`, `"como"`. Mantenho `"1"`, `"2"`, `"3"` numéricos (cobertos pelo parser numérico do engine) e mantenho `"primeiro"`, `"segundo"`, `"terceiro"` que não colidem.

Um UPDATE por passo (7 passos afetados), cada um reescrevendo só o próprio `transitions` jsonb com as phrases filtradas:

- `d_welcome` (aee7b26c…) — remove um, dois, três, tres, como das suas 3 transitions
- `d_como_funciona` (c87d76f8…) — remove dois, três, tres
- `d_resultado` (4df1f90a…) — remove um, três, tres
- `d_simular_resultado` (b1a52222…) — remove dois, três, tres, como
- `d_escolher_simulacao` (b1a53333…) — remove um, dois
- `d_como_funciona_copy_qwpu` (26b106c7…) — remove dois, três, tres
- (o copy_in3s será desativado em A, não precisa limpar)

Cada UPDATE usa `jsonb_path_query_array` para filtrar literalmente as phrases do array, sem reescrever o restante da transition.

### C. Typo no botão de `d_como_funciona_copy_qwpu`

```sql
UPDATE bot_flow_steps
SET captures = jsonb_set(
  captures,
  '{0,value,0,title}',
  '"✅ Continuar Cadastro"'
)
WHERE id='26b106c7-2679-42cb-b7f6-9392e4049f6d';
```

## Verificação pós-migration

Re-rodar `bun run .kiro/specs/fluxo-d-auditoria/audit.ts` (sem rede, determinístico) e confirmar:
- 0 HIGH, 0 MED restantes
- 22/22 jornadas PASS (incluindo "humano digitado no welcome" → handoff)
- 0 passos inalcançáveis ativos

Atualizar `report.md` com o resultado final.

## Sem efeitos colaterais
- Cada UPDATE escopado por `WHERE id=...` único
- Nenhum passo cópia é tocado por causa de outro
- Nenhuma alteração no engine v3 ou nos handlers
