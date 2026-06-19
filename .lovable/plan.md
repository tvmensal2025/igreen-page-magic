## Contexto

O QR escaneado pertencia ao parceiro **Horacio** (id `71fab01f…`, hoje inativo). O lead capturado foi:

- **Claudia Luciana da Silva** — `5511971254913`, instalação `15459083`, criado em 15/06.
- Hoje está com `referral_partner_id = NULL` (Horacio inativo não pôde ser atribuído).

A parceira **Nilma Santana** já está cadastrada e ativa:

- id `ec20af50-ffc5-4c92-9514-8227b1a75e86`
- short_code `431173`
- keyword: `Sou de Elias Fausto`
- qr_phrase: `Oi! gostaria de reduzir minha conta de luz, pode me ajudar? Sou de Elias Fausto.`

Ou seja, a frase nova **já está salva** no registro da Nilma — basta usar o QR/link dela (`/qr-redirect?p=ec20af50…` ou short_code `431173`) que o WhatsApp abre com o texto certo. Nenhuma alteração de código é necessária.

## Mudança a executar

Migração única, só `UPDATE` de 1 linha:

```sql
UPDATE public.customers
SET referral_partner_id      = 'ec20af50-ffc5-4c92-9514-8227b1a75e86',
    referral_keyword_matched = 'Sou de Elias Fausto'
WHERE id = '70ac123e-efb6-4356-ad2d-ba877b126f93';
```

Efeito: a Claudia passa a contar como lead da Nilma para cashback e relatórios. Horacio continua inativo (sem leads).

## Não vou mexer (a menos que peça)

- Não vou apagar os 2 registros do Horacio (`71fab01f…` e `6b7f601b…`) — ficam inativos apenas.
- Não vou alterar `qr-phrase.ts` nem o template padrão: a Nilma já tem `qr_phrase` própria salva e o `resolveQrMessage` respeita frases customizadas dentro do limite de 90 caracteres (a dela tem 81, passa direto).
- Não vou tocar em outros leads.

## Próximo passo do operador

Usar daqui em diante o QR/link da Nilma (short_code `431173`). O QR antigo do Horacio segue inativo e não vincula novos leads.
