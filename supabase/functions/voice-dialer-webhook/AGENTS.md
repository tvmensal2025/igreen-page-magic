# AGENTS — voice-dialer-webhook (Velip)

Domínio: `#voz-sms`.

## Fatos
- Upsert `voice_dnc_list` em IK/EK/CK/BK e SMS UNDELIV (≥2/72h)
- Cadência lê isso via `checkPhoneDeadForChannel` em `cadence-tick`
- UI: “Não Perturbe / bloqueado” — não label DNC

## NÃO FAÇA
- Contatar quem está em DNC lista / `do_not_contact`
- TTS com nome de fonte não confiável
