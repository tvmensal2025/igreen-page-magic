# 10 — O que Está Bom

> Última atualização: 08/06/2026

---

## O sistema tem uma base sólida. Aqui está o que funciona bem e deve ser mantido.

---

## 1. Segurança Backend ⭐

| Item | Por que é bom |
|------|---------------|
| `caller-auth.ts` | Comparação timing-safe do secret, prevenção IDOR, dois modos (service + JWT) |
| `assertOwnership()` | Verifica dono do recurso antes de qualquer operação |
| RLS em todas as tabelas | Camada de proteção no banco independente do código |
| SECURITY DEFINER nas RPCs | Funções privilegiadas isoladas |
| Service role separado | Frontend nunca vê service_role_key |
| Proxy para APIs | Chaves de Evolution/Whapi/MinIO NUNCA expostas no frontend |

---

## 2. Anti-Ban WhatsApp ⭐

| Item | Por que é bom |
|------|---------------|
| Warmup progressivo (D1=20 → D14+=600) | Simula comportamento orgânico |
| Intervalo mínimo entre mensagens | Não envia em rajada |
| Recovery mode | Trava 14 dias após ban para proteger novo chip |
| Circuit breaker | Para envios se falhas acumulam |
| Typing presence | Simula "digitando..." antes de enviar |
| Human jitter (700-2200ms) | Aleatoriedade entre mensagens |
| Quiet hours | Não envia de madrugada |
| Kill switch global + por consultor | Pode parar tudo instantaneamente |
| BroadcastChannel anti-QR-duplicate | Impede QR de duas abas |

**Avaliação:** Sistema anti-ban de nível profissional. Muito difícil de encontrar algo assim em projetos similares.

---

## 3. Idempotência e Deduplicação ⭐

| Item | Por que é bom |
|------|---------------|
| `outbound_message_log` | Impede envio duplo de mensagens |
| `webhook_message_dedup` | Impede processamento duplo de inbound |
| `customer_processing_lock` | Serializa processamento por cliente |
| `message_text_hash` (SHA-256 GENERATED) | Hash no banco detecta duplicata |
| `reserve_media_send` / `confirm_media_send` | Reserva atômica de envios de mídia |

---

## 4. Feature Flags ✅

| Item | Por que é bom |
|------|---------------|
| `flow_reliability_v2` (off/dark/canary/on) | Rollout gradual seguro |
| `flow_engine_v3` (mesmo padrão) | Deploy sem risco |
| Cache 30s in-process | Não sobrecarrega banco |
| Rollback simples (UPDATE SET 'off') | Reverter em segundos |

**Avaliação:** Padrão de feature flags maduro — permite deploy contínuo sem medo.

---

## 5. Arquitetura Frontend ✅

| Item | Por que é bom |
|------|---------------|
| Lazy loading de TODAS as páginas | Carregamento rápido |
| Manual chunks (Vite) | Paralelismo de downloads |
| PWA com cache strategies inteligentes | Funciona offline (parcialmente) |
| Supabase never cached (NetworkOnly) | Dados sempre frescos |
| React Query para server state | Cache + invalidação automática |
| shadcn/ui components | Consistência + acessibilidade |
| Tailwind CSS | Estilização rápida e consistente |
| TypeScript strict | Previne muitos bugs |

---

## 6. Infraestrutura de Bot ✅

| Item | Por que é bom |
|------|---------------|
| Múltiplos motores (legacy + conversacional + v3) | Flexibilidade |
| Router inteligente (flow-router.ts) | Decide qual engine usar |
| Vendedora IA com RAG + memória | Conversas contextuais |
| State machine para conversação | Progresso controlado |
| Bot health monitoring (SaudeBot, BotHealthIntel) | Visibilidade |
| Bot stuck recovery | Auto-correção |
| Bot loop watchdog | Detecta loops infinitos |
| Bot audit runner + e2e runner | Testes automatizados |

---

## 7. CRM e Kanban ✅

| Item | Por que é bom |
|------|---------------|
| Kanban com drag-and-drop | UX intuitiva |
| CRM stage sync automático | Bot move deals automaticamente |
| Lead temperature classifier | Priorização inteligente |
| Funil de vendas visual | Analytics claros |
| Customer enrichment | Dados preenchidos pelo bot |

---

## 8. Meta Ads Integration ✅

| Item | Por que é bom |
|------|---------------|
| OAuth completo (start → callback → refresh) | Fluxo robusto |
| Wallet prepaid | Sem risco de gasto descontrolado |
| Auto-pause | Proteção automática |
| Express campaign com IA | Baixa barreira para consultor |
| CAPI integration | Melhor otimização de campanha |
| Healthcheck + diagnósticos | Problemas detectados proativamente |

---

## 9. Documentação e Testes ✅

| Item | Por que é bom |
|------|---------------|
| .env.example bem documentado | Facilita onboarding |
| Property tests (fast-check) | Testa edge cases |
| Tests de kill-switch e caller-auth | Segurança testada |
| Comments inline nos módulos _shared | Facilita entendimento |
| evolution-webhook comments | Explicam o fluxo |
| README nos workers | Documentação de deploy |

---

## 10. Pipeline de Mídia ✅

| Item | Por que é bom |
|------|---------------|
| inbound_media_retry com TTL | Retry automático |
| pending_outbound_media queue | Envio assíncrono |
| media-dedupe | Não envia mesma mídia 2x |
| step-media-order | Ordem correta de envio |
| MinIO + Supabase Storage | Redundância |
| Compress worker | Otimização de tamanho |

---

## 11. Sistemas que NÃO devem ser mexidos sem necessidade

| Sistema | Motivo |
|---------|--------|
| Anti-ban (_shared/anti-ban.ts) | Funciona perfeitamente, risco de ban se alterar |
| caller-auth.ts | Segurança crítica, já validado |
| Idempotency system | Previne duplicatas — não mexer |
| Feature flags | Padrão simples e eficaz |
| shadcn/ui components | Auto-gerados, padronizados |
| Migrations aplicadas | NUNCA alterar migration já aplicada |
| PWA cache strategy | Bem configurada, previne HTML antigo |
| evolution-webhook dedup + lock + rate limit | Trio de proteção — não separar |

---

## Resumo

O projeto está **acima da média** em termos de:
- Proteção contra ban do WhatsApp
- Segurança entre edge functions (caller-auth)
- Controle de custos (token bucket, wallet)
- Infraestrutura de bot (dedup, lock, idempotency)
- Feature flags para deploy seguro

As fraquezas estão majoritariamente em:
- Organização do frontend (pastas grandes, hooks enormes)
- Segurança do frontend (sem route guards)
- Manutenção (120+ edge functions é muita coisa)
- Cleanup de dados (tabelas crescem sem limite)
