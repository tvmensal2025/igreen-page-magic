## Objetivo
Corrigir os 6 erros de TypeScript identificados na auditoria, destravando o CI/Deploy sem alterar lógica de negócio nem quebrar fluxos em produção (A/B/C, Pizza, Parceiros, Meta).

## Princípio de segurança
- Nenhuma mudança em motor de cadência, RPCs, edge functions críticas, RLS ou schema.
- Apenas ajustes de tipos e um bug silencioso de atribuição.
- Cada arquivo será lido antes de editar; edições cirúrgicas com `line_replace`.
- Validação por `tsgo` (typecheck) após cada bloco.

## Escopo — 6 correções

### 1. `src/components/admin/ReheatCyclePizza.tsx`
**Problema:** `ReferenceError` em variável usada em script de voz (referência a símbolo não importado/declarado).
**Ação:** Declarar/importar o símbolo faltante mantendo o comportamento atual do preview de voz.
**Risco:** Baixo — componente de UI, sem efeito no motor.

### 2. `src/components/admin/RetentionCard.tsx`
**Problema:** União de tipos larga demais causando erro de narrowing.
**Ação:** Estreitar o tipo do estado local para o subconjunto realmente usado (sem mudar dados).
**Risco:** Zero em runtime.

### 3. `src/lib/portal-worker.ts` (ou equivalente client-side)
**Problema:** União inconsistente entre payload esperado e retornado.
**Ação:** Alinhar tipo do retorno ao contrato já usado pelos consumidores.
**Risco:** Zero — apenas tipos.

### 4. `src/components/admin/CloseCaptureDialog.tsx`
**Problema:** Bug silencioso — atribuição marca "organic" mesmo quando há campanha detectada (fallback errado por checagem de tipo frouxa).
**Ação:** Corrigir condicional para respeitar `campaign_id`/`ctwa_clid` quando presentes; manter "organic" apenas como fallback real.
**Risco:** Baixo — melhora atribuição sem alterar schema.

### 5. `src/lib/__tests__/multichannelCadenceTexts.test.ts`
**Problema:** Testes quebrados referenciando exports antigos após refactor da biblioteca de textos.
**Ação:** Atualizar imports/asserts para a API atual de `multichannelCadenceTexts.ts`. Se o teste testar comportamento removido, marcá-lo como `it.skip` com comentário.
**Risco:** Zero em produção.

### 6. Sexto erro TS residual (a confirmar na leitura)
**Ação:** Identificar via `tsgo` e aplicar correção mínima do mesmo tipo (narrowing/import).

## Ordem de execução
1. Rodar `tsgo` para listar os 6 erros exatos e arquivos/linhas.
2. Ler os 6 arquivos em paralelo.
3. Aplicar edições cirúrgicas em paralelo por arquivo.
4. Rodar `tsgo` novamente — meta: 0 erros.
5. Smoke visual: abrir `/admin/agendamentos` e `/admin` (Cockpit) para confirmar que nada quebrou na UI.

## Fora de escopo (não tocar agora)
- Motor `cadence-tick`, `voice-dialer-*`, `wa-*`.
- Schema Supabase, RLS, migrations.
- Textos aprovados do Grupo B, áudios da Sofia.
- Layout do ForceDesktop e Cockpit (já validados).

## Rollback
Todas as mudanças são pontuais em arquivos client-side de tipos. Reverter é trivial via histórico do editor por arquivo, sem migrações ou secrets envolvidos.
