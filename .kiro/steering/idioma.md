---
inclusion: always
name: idioma
description: Respostas e raciocínio sempre em pt-BR.
---

# Idioma

- Responda sempre em português do Brasil (pt-BR).
- Use linguagem simples e direta, evitando jargão técnico desnecessário.
- Quando precisar usar um termo técnico, explique o que ele significa de forma curta.
- Comentários de código, explicações, specs e documentos também devem ser em português, quando possível.

## Erros na UI

- Nunca mostrar `error.message` cru (Auth inglês, SQL, `duplicate key`) no toast.
- Usar `toUserFacingError` (`src/lib/userFacingError.ts`); detalhe técnico só no console.
- “Já existe” → orientar login / recuperação, sem vermelho de falha grave.
- Toasts de erro com duração legível (~14s). Auditoria: `python3 scripts/audit-user-facing-errors.py`.
