# 11 — Segurança, custos e operação

---

## 11.1 Segurança

### API Keys Google

| Key | Onde | Restrição |
|-----|------|-----------|
| Server | Supabase secrets | APIs: Solar, Geocoding; IP Supabase |
| Client (opcional) | Vite env prefix `VITE_` | Maps JS só; referrer domínio |

Rotação: trimestral ou se vazamento.

### Autenticação

- Todas EFs consultor: `verify_jwt = true`.
- Validar `consultant_id` do JWT = owner do `customer_id`.
- Public: validar `proposal.public_token` + status `sent|viewed`.

### Dados sensíveis

- `building_insights` JSONB: **não** expor na API pública.
- Signed URLs Google expiram — não persistir como única fonte do preview.

### Abuse

- Rate limit por consultor (doc 06).
- Captação pública: captcha + 1 análise/IP/dia (Fase 5).

---

## 11.2 Custos estimados (planejar no spike)

Componentes de custo Google Maps Platform:

| Operação | Quando | Mitigação |
|----------|--------|-----------|
| Geocoding | Cada análise nova | Cache endereço |
| buildingInsights:findClosest | Cada análise | Cache lat/lng |
| dataLayers:get | Preview detalhado | Opcional; só HIGH/MEDIUM |
| Maps JS loads | Admin UI | Lazy load |

**Ação Fase 0:** registrar preço unitário atual na planilha do spike.

Modelo interno opcional:

- Descontar de `wallet` do consultor por análise (alinhar Meta Ads wallet).
- Ou incluir em plano premium.

---

## 11.3 Monitoramento

| Métrica | Alerta |
|---------|--------|
| Erro 403 Google | Imediato — billing |
| Erro 429 | Aumentar cache / throttle |
| Latência p95 > 60s | Investigar dataLayers |
| cache_hit < 30% | TTL ou uso |
| `imageryQuality=BASE` > 50% | Revisar fallback UX |

---

## 11.4 Secrets checklist deploy

```bash
GOOGLE_SOLAR_API_KEY
GOOGLE_GEOCODING_API_KEY  # ou unificada
# Opcional:
GOOGLE_MAPS_JS_KEY      # só se mapa client-side
```

Context7 Supabase: `Deno.env.get` — nunca logar valor.

---

## 11.5 Disaster recovery

- Google down: modo sketch + mensagem consultor.
- Cache expirado: re-fetch transparente.
- Storage preview perdido: re-render from snapshot geometry.

---

## 11.6 Compliance Google ToS

- Atribuição Google Maps/Solar onde exigido.
- Não armazenar imagery raw além do permitido — ver ToS atual no spike legal.
