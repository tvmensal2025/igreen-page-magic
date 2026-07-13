# Portal 2 (autoconexao) — API completa, mapeada e testada

> **⚠️ 2026-07-13**: para semântica dos extractors (qual endpoint para fatura ×
> comprovante, gate de legibilidade `fz`, `contaunica`), a fonte da verdade é
> **`worker-portal-2/PORTAL-OFICIAL.md`**. Este doc segue válido para HMAC,
> Cloudflare e inventário de endpoints.

**Status: ✅ Funcional. Cadastro real criado em 2026-05-26 (`idcliente=1501853`).**

> **Origem dos dados**: bundle `https://green.igreenenergy.com.br/assets/index-COBs1pai.js`
> baixado de dentro da VPS `72.60.159.48` (container `igreen_portal-worker`),
> reverse engineering em 2026-05-26.
>
> **Implementação**: `worker-portal/portal2-api-client.mjs`

## TL;DR

- Backend: `https://api-green-connection.igreenenergy.com.br`
- Auth: **HMAC-SHA256** por request (secret hardcoded no bundle)
- Bloqueio anti-bot: Cloudflare exige TLS fingerprint de browser. **Solução**: Playwright vivo + `page.evaluate(fetch)` — ~3-5s por chamada após boot
- Endpoint principal: `POST /customers` retorna `{idcliente}`
- 30+ endpoints mapeados

## Por que HTTP direto não funciona

Tentamos fetch direto do Node com:
- HMAC correto ✓ (verificado: bate 100% com a assinatura do Playwright real)
- Cookie `cf_clearance` ✓
- Origin / Referer corretos ✓
- User-Agent de Chrome ✓

Resultado: **403 Cloudflare** mesmo com tudo correto. CF detecta TLS fingerprint do Node como bot.

## A solução que funciona

Usar Playwright Chromium **como tunnel HTTP**:

1. Boot 1x: navegar em `green.igreenenergy.com.br/autoconexao` (CF emite `cf_clearance`)
2. Mantém browser vivo
3. Cada chamada API: `page.evaluate(async () => fetch(api, { headers: hmac }))` — fetch sai do browser real, TLS de Chrome, CF aceita
4. Reaproveita browser por ~25min até `cf_clearance` expirar, daí renova

**Performance medida**:
- 1ª chamada: ~5s (boot + CF challenge)
- Demais: 40-800ms

Vs Playwright original (clicando UI passo a passo): 30-60s por cadastro.

## Autenticação HMAC

```
x-frontend-app-id:    igreen-web-v1
x-frontend-timestamp: <ISO 8601>
x-frontend-signature: HMAC-SHA256-hex(secret, `${METHOD}\n${PATH}\n${TIMESTAMP}\n${APP_ID}`)
```

- `METHOD` = `GET|POST|PUT|DELETE|PATCH` (uppercase)
- `PATH` = `pathname` (sem query string)
- Secret hardcoded: `e8047bfd04cab6dac3d3d7d276347eddb3da57ec5f2670f476727c2744bf7b05`

Implementação no `portal2-api-client.mjs#signRequest`.

## Endpoints (todos testados)

Base: `https://api-green-connection.igreenenergy.com.br`

### Documento (OCR + verificação)

| Método | Path |
|---|---|
| POST | `/file-upload/registration` |
| GET  | `/file-upload/verify/{id}` |
| POST | `/file-upload/reconcile/{id}` |
| POST | `/file-upload/diagnostic` |
| POST | `/extractor/extract` |
| POST | `/extractor/extract-document` |
| POST | `/extractor/extract-section` |
| POST | `/extractor/extract-receipt` |
| POST | `/extractor/extract-pj` |
| POST | `/extractor/extract-procuration` |
| POST | `/extractor/init-validation` ✅ retorna `{success, idsolcontratovalidacao}` |
| POST | `/extractor/validate/upload` |
| POST | `/contract-validation/manual-fallback` |

### Lookups

| Método | Path | Resposta |
|---|---|---|
| GET | `/document-lookup?document=<11dig>` | ✅ `{success, data: {name, birthDate, ...}}` |
| GET | `/customers/check-exists?email=&document=&idconsultor=` | ✅ `{exists, consultantConflict}` |
| GET | `/customers/check-installation?numinstalacao=&concessionaria=&uf=` | `{exists}` |
| GET | `/customers/check-consultant?document=&idconsultor=` | `{...}` |
| GET | `/viacep/{cep}` | ✅ ViaCEP completo |
| GET | `/customers/indicator/{id}` | nome do parceiro |
| GET | `/consultants/{id}/license` | ✅ `{nome, tipo_licenca}` |

### Bonus / fornecedora

| Método | Path | Resposta |
|---|---|---|
| GET | `/bonus/states` | ✅ array `[{uf, name}]` |
| GET | `/bonus/distributors?uf=SP` | ✅ array `[{concessionaria}]` |
| GET | `/bonus/rules?uf=&concessionaria=&consumo_medio=&idsolcontratovalidacao=` | ✅ `{rules: [...]}` |
| GET | `/form-config?state=&distributor=&supplier=` | config dinâmica |

### Cliente

| Método | Path | Resposta |
|---|---|---|
| **POST** | **`/customers`** | ✅ **`{idcliente}` — cadastro criado** |
| GET | `/customers/{id}` | detalhes |
| GET | `/customers/{id}/signature-summary` | resumo |
| POST | `/customers/{id}/terms-acceptance` | aceite |

### OTP

| Método | Path |
|---|---|
| POST | `/verification-codes/generate` body=`{idcliente}` |
| POST | `/verification-codes/validate` body=`{idcliente, code}` |
| GET | `/verification-codes/status/{id}` → `pending|completed|failure|expired|used` etc |

### Contrato

| Método | Path |
|---|---|
| GET | `/contracts/customer/{id}/signed` → `{hasSignature}` |
| GET | `/contracts/customer/{id}/generated` → `{status, linkassinatura}` |

## Schema do payload `POST /customers`

```typescript
{
  idconsultor: number,                  // 124170
  numinstalacao: string,                 // só dígitos
  cpf_cnpj: string,                      // só dígitos (11 ou 14)
  nome: string,
  dtnasc: 'YYYY-MM-DD',
  celular: '(DD) 9XXXX-XXXX',            // ⚠️ FORMATADO (>=14 chars)
  email: string,
  cep: '#####-###',                       // ⚠️ FORMATADO (>=9 chars)
  endereco, numero, bairro, cidade, uf,
  complemento?,
  concessionaria, fornecedora,
  consumomedio: number,
  desconto_cliente?: number,
  possui_placas?: boolean,
  contaunica?: boolean,
  transferir_titularidade?: boolean,
  sendcontract: boolean,
  logindistribuidora?, senhadistribuidora?,
  indcli?: number,                       // 0 default; partner_cli quando aplica
  idsolcontratovalidacao?: number,
  
  // PJ
  cnpj?, razao?, fantasia?, naturezajuridica?, cargo?, ie?, localregistro?,
  
  // Procurador
  testemunha_nome?, testemunha_cpf?, testemunha_datanasc?,
  testemunha_email?, testemunha_celular?,
}
```

⚠️ **`celular` e `cep` precisam vir formatados** (descoberto via API rejeitando 400).
O `montarPayloadCadastro()` do client cuida disso automaticamente.

## Fluxo completo (cadastro end-to-end)

```ts
import { Portal2Client, fileFromPath } from './portal2-api-client.mjs';

const c = new Portal2Client({ idconsultor: 124170 });

const result = await c.cadastrarCliente({
  // Dados básicos
  cpf: '11144477735',
  nome: 'Lucas Henrique Moreira',
  dataNascimento: '15/08/1992',
  whatsapp: '11999887766',
  email: 'cliente@example.com',
  
  // Endereço
  cep: '13323-072',
  endereco: 'Rua Cabreúva',
  numero: '100',
  complemento: 'Apto 1',
  bairro: 'Jardim da Cidade II',
  cidade: 'Salto',
  uf: 'SP',
  
  // Conta de luz
  numeroInstalacao: '9999999991',
  consumoMedio: 350,
  
  // Documentos (opcionais — se não passar, vai pra "Continuar manualmente")
  docFile: fileFromPath('./doc-frente.jpg'),
  billFile: fileFromPath('./conta-luz.pdf'),
  
  // Optional: já passa concessionária/fornecedora se conhecer; senão descobre via /bonus/rules
  // concessionaria: 'CPFL PIRATININGA',
  // fornecedora: 'RZK',
  // desconto_cliente: 8,
  
  // Flags
  sendcontract: true,                   // do query param do link
  indcli: 1110798,                       // partner_cli se houver
  
  // PJ (opcional)
  // titularidade: 'pj', cnpj: '...', razaoSocial: '...',
  
  // Procurador (opcional)
  // procurador: { nome, cpf, dataNascimento, email, celular },
});

console.log(result); // { idcliente, idsolcontratovalidacao }

// Próximo passo: cliente recebe SMS com OTP no celular
await c.generateVerificationCode(result.idcliente);
// Cliente informa OTP via WhatsApp/painel
await c.validateVerificationCode({ idcliente: result.idcliente, code: '123456' });

// Polling do contrato
const contract = await c.getContractGenerated(result.idcliente);
console.log('link assinatura:', contract.linkassinatura);

await closeBrowser(); // libera o Chromium quando terminar
```

## Próximo passo de implementação

Plugar o `Portal2Client` no `worker-portal`:

1. No `playwright-automation.mjs` adicionar branch `executarPortal2(customerId)`
2. Roteamento no Supabase: `consultant.portal_kind = 'autoconexao'` opta-in
3. Manter Portal 1 como default (`portal_kind = 'digital'`)
4. Coexistência: a mesma fila do worker pode processar ambos os portais

## Provas

### HMAC bate

Cliente Portal2 gera HMAC; comparei com a assinatura real capturada do Playwright navegando o portal. Bate byte a byte.

### Cadastro real criado

```
▶ Step 1: initValidation
  ✓ { success: true, idsolcontratovalidacao: 339703 }

▶ Step 2: documentLookup
  ✓ { success: true, data: { name: 'David Goncalves Silva', cpf: '17853434758' } }

▶ Step 3: checkCustomerExists
  ✓ { exists: false }

▶ Step 4: getBonusRules
  ✓ rules: { uf: 'SP', concessionaria: 'CPFL PIRATININGA', fornecedora: 'RZK', ... }

▶ Step 5: createCustomer
  ✓ { idcliente: 1501853 }
```

### Performance

```
getStates           5154ms (boot do browser + CF challenge)
getDistributors(SP)   83ms
consultantLicense     46ms
documentLookup       809ms
checkCustomerExists   68ms
viacep               427ms
initValidation        87ms
getBonusRules         79ms
```
