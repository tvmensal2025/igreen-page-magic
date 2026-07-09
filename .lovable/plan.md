## Objetivo

1. Restaurar os 9 clientes do parceiro **Luiz Lyra** (que foi desativado por engano).
2. Unificar parceiros duplicados (mesmo `nome` + `partner_igreen_id`) sem perder clientes atribuídos.
3. Cadastrar automaticamente uma **keyword** para cada parceiro ativo que ainda não tem — sem risco de colidir com campanhas do Facebook (que hoje usam apenas `tracking_protocol` no formato `2026-####-X`, não keyword).

## Diagnóstico (dados reais)

**Duplicados detectados em `referral_partners`:**

| Nome | igreen_id | id (manter) | id (remover) | clientes |
|---|---|---|---|---|
| Luiz Lyra | 138518 | `b2003464…96c` (tem 9 clientes) | `11bf5f7f…175` (0 clientes) | 9 |
| Nilma Santana | 125483 | `6ee1fc81…564` (9 clientes) | `480f6eaf…d6b` (0 clientes) | 9 |
| CELIO | 5678 | `707aca64…6c9` (1 cliente) | `a536efcd…c84` (0 clientes) | 1 |
| Welington | 1237u | `011e8faf…7dc` (0 clientes) | `6317cb7b…8fc` + `829cdbfa…6bd` | 0 |

O caso do Luiz Lyra é o mais importante: a linha que **tem os 9 clientes** (`b2003464`) está com `is_active=false` — por isso ele "sumiu" do ranking. A linha ativa (`11bf5f7f`) tem 0 clientes.

**Parceiros ativos sem keyword:**
Abel Oliveira, Fracisco Melquiades, Luiz Lyra, Nilma Santana, Rafael Ferreira Dias, cezario (tem qr_phrase mas keywords vazio).

**Confirmação anti-colisão:** `facebook_campaigns` não usa mais keyword — campanhas são resolvidas exclusivamente pelo protocolo `YYYY-####-X`. Portanto keywords cadastradas aqui NÃO vão interferir em nenhuma campanha.

## Plano — Migração SQL única, idempotente

Vou executar **uma migração** que faz:

### 1. Unificar duplicados (função `merge_referral_partners`)

Para cada grupo `(nome, partner_igreen_id)` com mais de 1 linha:

- Escolhe o "sobrevivente" = a linha que tem **mais clientes** atribuídos; empate → a mais antiga (`created_at`).
- Move clientes: `UPDATE customers SET referral_partner_id = <sobrevivente> WHERE referral_partner_id = <duplicata>`.
- Consolida `keywords` (união dos arrays, sem duplicar).
- Preserva `qr_phrase` do sobrevivente; se estiver NULL, herda da duplicata.
- Marca sobrevivente como `is_active = true`.
- Deleta as linhas duplicadas.

Isso resolve automaticamente:
- **Luiz Lyra**: sobrevive `b2003464` (com 9 clientes), reativado, e `11bf5f7f` some.
- **Nilma Santana**: sobrevive `6ee1fc81` (9 clientes), `480f6eaf` some.
- **CELIO**: sobrevive `707aca64`, reativado.
- **Welington**: sobrevive `011e8faf` (mantém keyword `eias fausto1`).

### 2. Gerar keywords faltantes

Para cada parceiro ativo com `keywords = '{}'` OU `keywords IS NULL`:

- Deriva keyword a partir do **primeiro nome normalizado** (minúsculas, sem acento, sem espaço). Ex.:
  - Abel Oliveira → `abel`
  - Fracisco Melquiades → `fracisco`
  - Luiz Lyra → `luiz` (se colidir com outro, usa `luizlyra`)
  - Nilma Santana → `nilma`
  - Rafael Ferreira Dias → `rafael` (se colidir, `rafaelferreira`)
  - cezario → `cezario`
- Verifica colisão com keywords já existentes em outros parceiros; se houver, tenta o nome completo concatenado antes de gravar.
- Gera `qr_phrase` padrão quando estiver NULL, no mesmo formato do resto: `Olá, o(a) <Nome> me indicou vocês porque quero economizar na minha conta de luz, pode me ajudar?`

### 3. Índice para prevenir duplicação futura

`CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_nome_igreen_uidx ON referral_partners (consultant_id, lower(nome), partner_igreen_id) WHERE partner_igreen_id IS NOT NULL;`

Assim o sistema **não permite mais** cadastrar 2 parceiros com o mesmo nome + igreen_id no mesmo consultor.

## Detalhes técnicos

- Tudo roda dentro de uma transação (migração Supabase é atômica).
- A merge é implementada como função PL/pgSQL executada uma vez no fim da migração; fica disponível para uso futuro se o admin quiser mesclar manualmente 2 parceiros.
- Nenhuma alteração em Edge Functions ou frontend — o `AdminReferralPartnersPage` já lê a tabela como está.
- Sem risco para campanhas: nenhuma coluna de `facebook_campaigns` é tocada; o resolver de webhook prioriza protocolo `YYYY-####-X` e keyword é fallback apenas para leads sem protocolo.

## Resultado esperado

- Luiz Lyra volta ao ranking com 9 clientes atribuídos.
- Nilma Santana aparece uma única vez com 9 clientes.
- CELIO e Welington aparecem uma única vez cada.
- Todos os parceiros ativos passam a ter keyword + frase de QR válidas.
- Não é mais possível criar duplicata acidental.
