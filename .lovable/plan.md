# Smoke test E2E /admin com Playwright

## Objetivo

Validar 12 áreas do painel admin com fluxo completo (carregamento + interação/CRUD), entregando tabela de status, screenshots e captura de erros console/network.

## Pré-requisitos do usuário

Antes de eu rodar, preciso de **2 coisas**:

1. **Credenciais de um admin de teste** (email + senha) — cole no chat. Vou usar uma única vez para login via Playwright; não são logadas nem persistidas.
2. **Aprovação para mutações reais.** Você pediu "CRUD/ações reais quando possível". Isso pode criar/alterar dados de produção (ex.: criar consultor de teste, mover deal no kanban, salvar configuração). Confirme:
  - ✅ OK criar/editar registros marcados como `SMOKE-TEST-<timestamp>` que eu apago no fim
  - ❌ ou prefere read-only: só abrir telas, abrir modais, alternar tabs, ler dados — sem POST/PATCH/DELETE

Se preferir read-only, o smoke vira só "carregamento + navegação", igual à opção média. Recomendo isso para a primeira rodada e depois aprofundamos.

## Áreas cobertas (12)


| #   | Área                                       | Rota provável               | Ação chave                                                          |
| --- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------- |
| 1   | Clientes interessados                      | `/admin` → tab Interessados | Listar, abrir card, ler detalhes                                    |
| 2   | Clientes ativos                            | `/admin` → tab Ativos       | Listar, abrir card                                                  |
| 3   | Conversão                                  | `/admin/conversao`          | Fila → Reaquecimento → **Configurar** (validar auto-save sem botão) |
| 4   | Clientes (CRM)                             | `/admin` (kanban)           | Abrir deal, ler stages                                              |
| 5   | Produtos & Vendas                          | `/admin` produtos           | Listar produtos, abrir 1 venda                                      |
| 6   | Captação                                   | `/admin` captação           | Abrir formulário, validar campos                                    |
| 7   | Parceiros                                  | `/admin` parceiros          | Listar referral_partners                                            |
| 8   | Rede                                       | `/admin` rede               | Listar network_members                                              |
| 9   | WhatsApp                                   | `/admin` whatsapp           | Status instância, fluxos B/D                                        |
| 10  | Central de Anúncios                        | `/admin` anúncios           | Listar campanhas FB                                                 |
| 11  | Links                                      | `/admin` links              | Listar                                                              |
| 12  | Materiais + Estúdio Áudio + iGreen Academy | rotas respectivas           | Carregar página, listar itens                                       |


## Execução técnica

Script único `/tmp/browser/admin-smoke/run.py` (Playwright async, Chromium headless, viewport 1280×1800):

1. **Login** em `http://localhost:8080` com credenciais fornecidas → aguarda redirect autenticado.
2. **Mapear rotas reais** lendo `src/App.tsx` e `src/pages/Admin*.tsx` antes do run (descobrir paths corretos das 12 áreas).
3. **Para cada área**, em sequência:
  - `page.goto(rota)` com `wait_until="networkidle"`
  - Aguardar seletor âncora (heading h1/h2 da página) — confirma render sem branco
  - Screenshot `NN_area-nome.png`
  - Executar ação chave (clique em tab/abrir modal/etc) — screenshot pós-ação
  - Coletar `console` errors e `network` responses 4xx/5xx via listeners registrados no `context`
4. **Caso 3 (Configurar)** — validação específica do fix recente:
  - Alterar o campo "Máximo de tentativas" para um valor `+1`
  - Aguardar 1.2s (debounce 600ms + folga)
  - Recarregar a página, voltar para Configurar, verificar que o novo valor persistiu sem clicar em nenhum botão Salvar
5. **Cleanup**: se houver mutações marcadas `SMOKE-TEST-*`, deletar via Supabase REST ao final.

## Saída

Arquivo `/tmp/browser/admin-smoke/report.md` com:

- Tabela: Área | Status (✅/⚠️/❌) | URL final | Tempo de carga | Erros console | 4xx/5xx
- Lista detalhada de cada erro encontrado (mensagem + stack curta + request)
- Galeria de screenshots inline
- Veredito: pronto pra produção / áreas que precisam fix

O relatório vem no chat + screenshots anexadas.

## Tempo estimado

~15-20 min de execução real, mais 5 min para mapear rotas e escrever o script.

---

**Próximo passo:** me responda com (a) credenciais admin de teste e (b) read-only ou pode mutar com cleanup.  
usuario: [rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)  
senha:10203040