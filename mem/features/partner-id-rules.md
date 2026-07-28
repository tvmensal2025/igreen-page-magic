---
name: Regras de ID iGreen e parceiro
description: Dois campos distintos — consultor/abonador (cli) vs cliente cashback (partner_igreen_id).
type: feature
---

Dois papéis no cadastro de indicador (`referral_partners`):

1. **`cli` = consultor / abonador**
   - Quem abona o cadastro (`?id=` / `idconsultor` no Portal).
   - Padrão = ID iGreen do dono da plataforma (ex.: Rafael `124170`).
   - Se o indicador **for consultor** (ex.: Abel `137238`), o ID dele vai **neste campo** — ele abona no lugar do dono.
   - Nunca colocar consultor em `partner_igreen_id`.

2. **`partner_igreen_id` = cliente (cashback)**
   - Só quando o indicador é **cliente**, não consultor.
   - Vai no `&cli=` do link de cadastro (cashback).
   - Se for consultor, deixe **vazio**.

Links:
- Consultor abonador: `?id={cli}`
- Cliente cashback sob o dono: `?id={dono}&cli={partner_igreen_id}`
- Consultor + cliente (raro): `?id={cli}&cli={partner_igreen_id}`

Nunca misturar: consultor no campo de cliente (bug do Abel) nem cliente no campo de abonador.
