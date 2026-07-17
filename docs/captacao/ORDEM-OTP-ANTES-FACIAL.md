# Ordem final do cadastro — OTP antes da facial

**Data:** 2026-07-16  
**Status:** regra de produto no Multicanal / template Sofia

---

## Ordem obrigatória

```
8 — Confirmar telefone
        ↓
9 — Envia cadastro ao portal + pede digitar o OTP
        ↓  (cliente digita o código no WhatsApp)
        ↓  (otp_validated)
10 — Envia o link → Assinar documentos → validação facial
```

| Passo | O que acontece | O que NÃO fazer |
|-------|----------------|-----------------|
| **9** | Portal + pedir OTP; **aguardar** o código | Enviar link da facial |
| **10** | Link → *Assinar documentos* → facial (comprovar que é você) | Pedir OTP de novo |

---

## Chaves no catálogo

- `a10_portal_otp_facial` → título **9 — Portal + digitar OTP**
- `a11_facial_link` → título **10 — Link da facial (após OTP)**

Motor do bot: `portal_submitting` / aguardando OTP → só então `aguardando_facial` com `link_facial`.

---

## Aceite

- [ ] Após telefone, mensagem fala só de OTP (não mistura facial)
- [ ] Facial só aparece depois do OTP confirmado
- [ ] Placeholder `{{link_facial}}` no passo 10 quando o sistema tiver a URL
