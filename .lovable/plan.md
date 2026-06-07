## Rodar bateria de validação com 5 conversas difíceis

Após os fixes aplicados (pedido_humano, desistência, titularidade, cnpj, homologação, recap, sanitize nome), rodar 5 novas conversas para validar coerência.

### Execução

```bash
code--copy knowledge://skill/vendedora-e2e-conversations/scripts/run.ts /tmp/run.ts
bun /tmp/run.ts --scenario-set dificil --max 5 \
  --out /mnt/documents/vendedora-runs/duvidas-dificeis-v3
```

### Cenários (5 primeiros do `SCRIPTED_DIFICEIS`)

1. **bombardeio-inicio** — lead joga 4 perguntas seguidas antes de qualquer coisa
2. **volta-mesmo-tema** — lead pergunta "vem 2 boletos?" repetidamente em pontos diferentes
3. **objecao-no-meio** — aceita, depois objeção forte no meio do cadastro
4. **tecnico-engenheiro** — pergunta CNPJ, homologação ANEEL, contrato
5. **reclamacao-enel** — desabafa sobre Enel antes de decidir

### Critérios de validação

- ≥4/5 chegam em `cadastro_finalizando`
- 0 `DUVIDA_IGNORADA`
- 0 `REPETIU_TEMA`
- 0 `HANDOFF_INCOERENTE`
- Pergunta "vem 2 boletos?" respondida em qualquer turno
- Saudação não contém handle técnico (ex: `tvmensal22`)
- Nome "Cláudia Reis" extraído mesmo com prefixo "ok confio,"

### Entregável

Auditoria turno-a-turno das 5 conversas + diff vs `duvidas-dificeis-v1`, apontando bugs remanescentes (se houver) e propondo próximos fixes.
