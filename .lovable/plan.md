# Análise da plataforma (sessão Playwright como [rafael.ids@icloud.com](mailto:rafael.ids@icloud.com))

Naveguei autenticado por: `/auth` → `/super-admin` (abas Consultores, Captação, Gestores Ads, Saúde da Rede, Funil do Bot) → `/admin` (Painel, Captação no sidebar).

## Resultado

**Captação do nome está OK.** A página `/admin` (Captação no sidebar) abriu normalmente, sem o erro antigo de nome. A aba Captação do Super Admin também renderizou KPIs e card "Conexão Segura" sem exceções.

**Erros do console (filtrados):**


| Erro                                                                                            | Origem                                               | Real?                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `Manifest fetch ... 401` em `/manifest.json`                                                    | Sandbox do preview da Lovable                        | ❌ Ruído — não acontece em produção |
| `postMessage target origin mismatch` (lovable.js)                                               | iframe do editor Lovable                             | ❌ Ruído                            |
| `r.split is not a function` em `chrome-extension://...`                                         | Extensão do Chrome do usuário                        | ❌ Não é do app                     |
| `Lock broken by another request 'steal'` (Supabase auth)                                        | StrictMode + múltiplos `getSession` em paralelo      | ⚠️ Cosmético, auto-recupera        |
| `**400 Bad Request` em `whatsapp_instances?select=...consultants:consultant_id(name,license)**` | `src/components/superadmin/SystemHealthPanel.tsx:55` | ✅ **Erro real**                    |


## Causa do único erro real

`SystemHealthPanel` faz embed PostgREST `consultants:consultant_id(name, license)`, mas a tabela `whatsapp_instances` **não tem foreign key** para `consultants` (confirmei via `information_schema`). Sem FK, o PostgREST recusa o embed com 400. Esse painel roda a cada 60 s no Super Admin → polui o console e não mostra instâncias caídas.

## Plano de correção

Apenas 1 arquivo, sem migration nem mudança de banco.

### `src/components/superadmin/SystemHealthPanel.tsx`

1. Remover o embed `consultants:consultant_id(name, license)` do `.select(...)` (linha 55).
2. Após receber `downRows`, fazer uma segunda query agregada: `supabase.from("consultants").select("id, name, license").in("id", uniqueConsultantIds)`.
3. Montar um `Map<consultant_id, {name, license}>` e usar no `rows.map(...)` (linhas 65-73) em vez de `r.consultants?.name`.
4. Se `consultantIds` estiver vazio, pular a segunda query.

Resultado: zero erro 400, painel volta a listar instâncias com nome do consultor.

## Não vou mexer (sem evidência de problema)

- Página Captação (nome) — funcionando.
- AudioStudio / re-render loop — já corrigido nas mensagens anteriores; não disparou nesta sessão.
- `whapi-proxy` — sem novos 500 nos logs da edge function.
- Lock warning do gotrue — comportamento conhecido do StrictMode, não causa falha funcional.
- Manifest 401 — exclusivo do iframe de preview da Lovable.

## Próximo passo

Aprove para eu aplicar a correção no `SystemHealthPanel.tsx`.  
  
LEBRANDO QUE ESTAMOS NO SUPERADMIN E ELE SE CONECTA NO WHAPI E OS OUTROS CONSULTORES NO EVOLUTION  
  
FACA MAIS UMA ANALISE PARA CORRIGIR