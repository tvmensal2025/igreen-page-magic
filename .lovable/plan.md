# Plano: Resetar senha da Bruna + Auditoria Mobile

## Parte 1 — Senha da Bruna (correção pontual)

**Diagnóstico:**
- `brunabwk@gmail.com` (uid `f08b9176...`) existe em `auth.users`, e-mail confirmado, **não está banida**.
- Existe `consultants` com `approved=true`, `license=brunabwk-f08b`.
- Último login bem-sucedido: 15/06. Hoje (20/06) ela diz "senha inválida".
- Conclusão: senha esquecida/digitada errado. Não é bug de código.

**Ação (uma das duas — escolha sua):**

**Opção A (recomendada, sem código):** você reseta direto no painel Supabase Auth → Users → buscar `brunabwk@gmail.com` → "Send password recovery" ou "Reset password". Eu te passo o link clicável.

**Opção B:** eu disparo via SQL/edge function um e-mail de recuperação pra ela usando `supabase.auth.admin.generateLink({ type: 'recovery' })` numa edge function temporária do Super Admin. Só faço se você pedir — envolve criar uma edge function nova.

Não vou mexer no fluxo de login (`src/pages/Auth.tsx`) — está funcional, "Esqueci minha senha" já existe na tela.

## Parte 2 — Auditoria mobile (somente relatório, zero edição)

**Viewport de teste:** 390×844 (iPhone 13/14 padrão) e 360×800 (Android comum).

**Páginas/fluxos a auditar via Playwright logado como `rafael.ids@icloud.com`:**

| # | Área | Rota / Componente | O que verifico |
|---|---|---|---|
| 1 | Criação de áudio | `audio_library` + `AudioWhatsAppPopover` (gravador opus) | Botão de gravar acessível, popover não estoura tela, input de telefone usável |
| 2 | WhatsApp | `/admin` aba WhatsApp + `WhatsAppStatusPill`, QR code de pareamento | QR não cortado, botões "Conectar/Desconectar" tocáveis |
| 3 | Captação | `/super-admin` → `CaptacaoTab` + `WhatsAppStatusPill` captação | Tabela rola horizontal, filtros não cobrem conteúdo |
| 4 | Parceiros | `ParceirosTab` + `PartnerList` + `PartnerForm` | Tabela com scroll, modal de form cabe em 390px, dialog de delete |
| 5 | Gerar QR Parceiro | `PartnerQrCode` | QR renderiza, botão download tocável, modal fecha |
| 6 | Navegação | Header/Sidebar do Admin e SuperAdmin | Menu hamburger abre, não trava scroll |

**Entregável:** um relatório no chat com, para cada item:
- ✅ funcional / ⚠️ funcional com problema / ❌ quebrado
- Print (se quebrado)
- Linha/arquivo do problema
- Severidade (bloqueante vs cosmético)

**O que NÃO farei nesta rodada:**
- Não edito nenhum arquivo `.tsx`/`.ts`/CSS.
- Não rodo migrações.
- Não toco em edge functions.
- Após receber o relatório, você decide o que corrigir numa próxima mensagem.

## Tempo estimado
~5–7 min de Playwright (login + 6 fluxos × 2 viewports + screenshots).
