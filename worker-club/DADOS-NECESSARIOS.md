# Dados necessários — cadastro iGreen Club (WorkerClub)

> Payload oficial do `POST /submit-lead` → `POST /cliente/club`.
> Confirmado ao vivo em **2026-07-15** (idcliente `1639523`).
> Fonte: `CLUB-OFICIAL.md` + teste real no worker.

Worker: `https://igreen-worker-club.d9v63q.easypanel.host/`

---

## Obrigatórios (PF)

| Campo | Exemplo | Observação |
|---|---|---|
| `idconsultor` | `124170` | ID iGreen do **consultor dono** do cadastro (sempre o dele, não fixo) |
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
| `uf` | `SP` | sigla (2 letras) |

O worker normaliza máscaras sozinho (CPF, celular, CEP, data) e resolve `uf_select` (IBGE) a partir da UF.

---

## Opcionais

| Campo | Default | Observação |
|---|---|---|
| `complemento` | `""` | apto, sala, etc. |
| `indcli` | `0` | indicador (se houver) |
| `dryRun` | `true` | `false` = cadastro **real** |
| `customer_id` | — | só grava status `club_*` no CRM (opcional) |

---

## Exemplo mínimo (cadastro real)

```bash
curl -s -X POST https://igreen-worker-club.d9v63q.easypanel.host/submit-lead \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

Resposta de sucesso (shape confirmado): inclui `idcliente`, `origem: "CLUB"`, dados ecoados.

---

## O que NÃO precisa

Isso é **só Club** — não misturar com Portal 2 (energia):

- ❌ Foto / documento OCR  
- ❌ Conta de luz / instalação  
- ❌ OTP WhatsApp  
- ❌ HMAC / API `api-green-connection`  

---

## Auth do worker

Header: `Authorization: Bearer ${WORKER_SECRET}`

Env no Easypanel: ver `EASYPANEL.md`.
