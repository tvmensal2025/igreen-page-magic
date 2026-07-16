# Dados necessários — cadastro iGreen Club (PF)

Fonte: mapeamento oficial + cadastro real validado em **2026-07-15**
(`idcliente` 1639523 via `https://igreen-worker-club.d9v63q.easypanel.host/`).

Endpoint: `POST /submit-lead`  
Auth: `Authorization: Bearer ${WORKER_SECRET}`  
Worker: serviço **independente** (não é Portal 2).

---

## Obrigatórios (PF)

| Campo | Exemplo | Observação |
|---|---|---|
| `idconsultor` | `124170` | ID iGreen do consultor (sempre o do dono do lead) |
| `cpf` | `14755348684` | CPF válido (com ou sem máscara) |
| `nome` | `João da Silva Santos` | mín. 5 caracteres |
| `dtnasc` | `15/03/1988` | `dd/mm/aaaa` |
| `rg` | `458726159` | mín. 5 caracteres |
| `email` | `cliente@gmail.com` | e-mail válido |
| `celular` | `11988776655` | celular BR com DDD |
| `cep` | `01310100` | 8 dígitos |
| `endereco` | `Avenida Paulista` | logradouro |
| `numero` | `1578` | número |
| `bairro` | `Bela Vista` | |
| `cidade` | `São Paulo` | |
| `uf` | `SP` | sigla |

O worker normaliza máscaras sozinho (CPF, celular, CEP) e resolve `uf_select` (IBGE) a partir da UF.

---

## Opcionais

| Campo | Default | Observação |
|---|---|---|
| `complemento` | `""` | apto, sala, etc. |
| `indcli` | `0` | indicador (se houver) |
| `dryRun` | `true` | `false` = cadastro real |
| `customer_id` | — | só grava status `club_*` no CRM |

---

## Exemplo mínimo (cadastro real)

```json
{
  "dryRun": false,
  "dados": {
    "idconsultor": 124170,
    "cpf": "14755348684",
    "nome": "João da Silva Santos",
    "dtnasc": "15/03/1988",
    "rg": "458726159",
    "email": "cliente@gmail.com",
    "celular": "11988776655",
    "cep": "01310100",
    "endereco": "Avenida Paulista",
    "numero": "1578",
    "bairro": "Bela Vista",
    "cidade": "São Paulo",
    "uf": "SP"
  }
}
```

```bash
curl -s -X POST https://igreen-worker-club.d9v63q.easypanel.host/submit-lead \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

---

## O que NÃO precisa (isso é Portal 2 / energia)

- Foto de documento / fatura
- OCR
- Número de instalação
- OTP WhatsApp
- Contrato / biometria

---

## Resposta de sucesso (shape real)

```json
{
  "ok": true,
  "queued": false,
  "dryRun": false,
  "result": {
    "success": true,
    "response": {
      "idcliente": 1639523,
      "origem": "CLUB",
      "idconsultor": 124170,
      "cpf_cnpj": "147.553.486-84",
      "nome": "..."
    }
  }
}
```

Campo-chave: `result.response.idcliente`.

---

Ver também: `CLUB-OFICIAL.md` · `EASYPANEL.md` · `README.md`
