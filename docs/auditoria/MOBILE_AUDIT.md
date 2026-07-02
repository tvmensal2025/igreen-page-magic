# Auditoria Mobile — iGreen Portal

Data: 2026-07-02
Viewports testadas: iPhone SE (375×667) e iPhone 13 (390×844)
Rotas auditadas: 27 rotas × 2 viewports = **54 auditorias**

## Resultado final

| Métrica | Antes | Depois |
|---------|-------|--------|
| Overflow horizontal | 0 | 0 |
| Rotas com 🔴 crítico | 0 | 0 |
| Rotas com 🟡 tap-targets < 40px | 54 | **0** |
| Rotas ✅ verdes | 0 | **54** |

## Correções aplicadas

### 1. `src/components/CookieBanner.tsx` (aplica a TODAS as páginas)
- Botões Aceitar / Rejeitar: `h-7` → `min-h-11` no mobile
- Botão Fechar (X): `32×32px` → `44×44px` (`min-h-11 min-w-11`)
- Fonte dos botões: `text-[11px]` → `text-xs`

### 2. `src/pages/Auth.tsx`
- Toggle "olho" (mostrar/ocultar senha): sem tamanho → `44×44` + `aria-label`
- Link "Esqueci minha senha": `text-xs` sem altura → `text-sm min-h-11`
- Links "Criar conta" / "Fazer login" / "Voltar ao login": sem altura → `min-h-11`

### 3. `src/components/ui/ThemeToggle.tsx` (usado em várias páginas)
- Toggle de tema: `36×36` → `44×44` (`min-h-11 min-w-11`)

### 4. `src/pages/PoliticaPrivacidade.tsx`
- Link "← Voltar": `22px` altura → `44px`

### 5. `src/pages/InstallPage.tsx`
- Link "Voltar para o painel": `17px` altura → `44px`

## Rotas auditadas

**Públicas:** `/auth`, `/install`, `/reset`, `/politica-privacidade`, `/demo`, `/pagina-inexistente-404`
**Cadastro / propostas:** `/cadastro/demo`, `/licenciado/preview`, `/r/demo`
**Conexões (9 produtos):** `/conexao-telecom`, `/conexao-seguros`, `/conexao-solar`, `/conexao-placas`, `/conexao-livre`, `/conexao-club`, `/conexao-club-pj`, `/conexao-green`, `/conexao-expansao`
**Painel admin (autenticadas — redirecionam p/ /auth quando deslogado):** `/admin`, `/admin/whatsapp-clients`, `/admin/fluxos`, `/admin/saude-bot`, `/admin/conhecimento`, `/admin/reaquecimento`, `/admin/conversao`, `/admin/portal-monitor`, `/admin/solar-design`

## O que já estava OK (não precisou de fix)

- **Zero overflow horizontal** em nenhuma rota, nenhum viewport — layout responsivo do projeto está sólido
- Cards, seções e navbars das landings de Conexão respondem bem a 375px
- Uso consistente de `useIsMobile` / `useIsLgDown` para trocar sidebar↔drawer
- Tokens semânticos do design system respeitados (nenhum `text-white`/`bg-black` hardcoded)

## Nota sobre rotas admin autenticadas

As rotas admin foram auditadas deslogadas (o `ProtectedRoute` redireciona para `/auth`, então a página renderizada é a de login). Uma auditoria autenticada das abas internas (Dashboard, CRM, Kanban, WhatsApp, Captação, Templates, Fluxo Builder, Solar 3D) exigiria sessão Supabase injetada — não disponível nesta execução. Recomenda-se rodar `tests/e2e/mobile-audit.spec.ts` estendido com login real na próxima onda se surgirem relatos de usuários mobile no painel.

## Como reproduzir a auditoria

```bash
python3 /tmp/browser/audit/run.py
```

Screenshots geradas em `/tmp/browser/audit/out/` (54 imagens).
