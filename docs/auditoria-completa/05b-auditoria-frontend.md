# Auditoria Frontend (Etapa 5) — evidências

**Data:** 2026-07-16  
**Escopo:** hooks, auth, storage, realtime, XSS, permissões de UI  
**Modo:** somente leitura  

> Achados formais com ID `AUD-XXX` estão em `10-achados-p0-p1.md` / `11` / `12`.

---

## 1. Autenticação e autorização na UI

| Componente | Comportamento | Evidência |
|---|---|---|
| `ProtectedRoute` | Só exige sessão Supabase | `src/components/auth/ProtectedRoute.tsx` L19–58 |
| `useAdminAuth` | Carrega consultor; cria pending se ausente; race guard com requestId | `src/hooks/useAdminAuth.ts` L54–120 |
| `useUserRole` | `isAdmin` = `has_role(admin)` **OU** `is_super_admin`; expõe `isSuperAdmin` separado | `src/hooks/useUserRole.ts` L25–33 |
| `SuperAdmin` | Bloqueia com `if (!isAdmin)` — **não** usa `isSuperAdmin` | `src/pages/SuperAdmin.tsx` L83, L101–109 |
| `/assistente` | Rota pública; chat FAQ; history em localStorage | `App.tsx` L141; `AssistentePage.tsx` L30–47 |

**Consequência:** qualquer usuário com role `admin` (não necessariamente super) entra no painel Super Admin na UI. Isolamento real depende de RLS/`is_super_admin` nas mutations — a UI não é a barreira.

---

## 2. Storage sensível

| Chave / padrão | Onde | Conteúdo | Risco |
|---|---|---|---|
| `customers_cache_${userId}` | `Admin.tsx` L182–251 | Cache de clientes (nome, telefone, CPF, endereço…) em **sessionStorage** | Médio — PII no browser; limpa ao fechar aba |
| `network_cache_${consultantId}` | `NetworkPanel.tsx` | Rede/downline | Médio |
| `igreen-chat-history` | `AssistentePage` | Histórico chat público | Baixo |
| `flowSim:otpRealPhone` | `FlowSimulator.tsx` | Telefone real OTP em localStorage | Médio |
| Preferências UI (tabs, sidebar, tour) | vários | Não sensível | Baixo |
| Auth session | supabase-js → localStorage | JWT padrão Supabase | Esperado |
| Credenciais portal | `useAdminAuth` **não** persiste `igreen_portal_password` no form após load (seta `""`) | Bom | — |

**Fail-open DNC no envio manual front:**

```162:179:src/services/messageSender.ts
  // Hard gate: lead em lista de não contato
  if (customerId) {
    try {
      // ... select do_not_contact ...
    } catch {
      // se a checagem falhar, segue (não derruba chat por blip de rede)
    }
  }
```

Contrasta com `assertCanContact` (backend) que falha **fechado**.

---

## 3. Realtime / subscriptions

Arquivos com `.channel(` incluem: `useMessages`, `useChats`, `useNotifications`, `useCaptureSession`, `useCustomerAttendance`, `useConsultantPresence`, `useOcrReviewQueue`, `useWalletGuard`, painéis de captação/portal, remote-support.

Hooks principais listam `unsubscribe`/`removeChannel` em cleanup — padrão presente em `useAdminAuth`, `useMessages`, `useChats`, etc.  
**Pendente:** auditoria arquivo-a-arquivo de leaks (canal duplicado ao trocar customerId sem cleanup) — marcar para continuação.

`Admin.fetchCustomers` usa `AbortController` (L186–194) — bom contra race.

---

## 4. XSS / HTML inseguro

| Arquivo | Uso | Avaliação |
|---|---|---|
| `FlowSimulator.tsx` L46 | `dangerouslySetInnerHTML` | **Necessita revisão** do sanitizer |
| `components/ui/chart.tsx` L70 | CSS injetado (recharts pattern) | Baixo se só estilos gerados |

---

## 5. Componentes gigantes / responsabilidade

| Arquivo | Linhas (aprox.) | Nota |
|---|---:|---|
| `ChatView.tsx` | muito grande | UI + envio + captura |
| `Admin.tsx` | ~660+ | Hub de tabs |
| `NetworkPanel.tsx` | ~1000+ | Sync + cache |
| `useMessages.ts` | ~800+ | Evolution+Whapi+map+send |

---

## 6. Paginação

`fetchCustomers` pagina de 1000 em 1000 (`range`) até esgotar — correto acima de 1000, mas carrega **todos** os clientes do consultor na memória + sessionStorage. Risco de performance em carteiras grandes (P2).

---

## 7. PWA / service worker

Confirmado em `main.tsx` + `vite.config.ts`: não registra SW de cache; kill-switch de SW legado; version gate via `/version.json`.  
`vite-plugin-pwa` no package.json **não** está no Vite — divergência cosméticas de dependência.

---

## 8. Continuação frontend

- [ ] Revisar sanitização do FlowSimulator HTML  
- [ ] Mapear canais realtime sem unsubscribe  
- [ ] Verificar botões que toastam sucesso antes da resposta EF  
- [ ] Error boundaries além de WhatsApp  
- [ ] Query keys React Query inconsistentes  
