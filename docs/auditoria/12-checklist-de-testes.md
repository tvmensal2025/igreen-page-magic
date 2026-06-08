# 12 — Checklist de Testes

> Última atualização: 08/06/2026

---

## Testes Funcionais

### Login e Autenticação

- [ ] Login com email/senha funciona
- [ ] Erro claro ao errar senha
- [ ] Redirect para /admin após login
- [ ] Logout limpa sessão
- [ ] Token refresh funciona (deixar aberto 1h)
- [ ] Usuário não aprovado vê modal de pendente
- [ ] Usuário aprovado vê dashboard completo
- [ ] Super admin vê painel super admin
- [ ] Admin vê tab de admin
- [ ] Usuário comum NÃO vê botões de admin

### Cadastro

- [ ] Novo usuário cria conta
- [ ] Email de verificação é enviado (se configurado)
- [ ] Registro auto-cria consultant com approved=false
- [ ] Slug é gerado corretamente do nome/email

### Dashboard (/admin)

- [ ] Dashboard carrega sem erros
- [ ] Estatísticas mostram dados corretos
- [ ] Gráficos renderizam
- [ ] Tabs navegam corretamente
- [ ] Links funcionam (WhatsApp, Fluxos, Meta Ads)
- [ ] Preview da página pública funciona
- [ ] Dados pessoais (nome, telefone) editáveis
- [ ] Upload de foto funciona
- [ ] iGreen ID salva corretamente

### Leads e Clientes

- [ ] Lista de clientes carrega
- [ ] Busca por nome/telefone funciona
- [ ] Filtros por status funcionam
- [ ] Criar cliente manual funciona
- [ ] Editar cliente funciona
- [ ] Excluir cliente funciona
- [ ] Import/export de clientes funciona

### CRM / Kanban

- [ ] Kanban carrega com colunas corretas
- [ ] Cards mostram informações do deal
- [ ] Drag-and-drop move deal entre colunas
- [ ] Deal salva nova posição no banco
- [ ] SLA indicators funcionam
- [ ] Reclassificar deal funciona

### WhatsApp (Chat)

- [ ] Instância conecta (QR code aparece)
- [ ] Status muda para "connected" após scan
- [ ] Lista de chats carrega
- [ ] Selecionar chat mostra mensagens
- [ ] Enviar texto funciona
- [ ] Enviar imagem funciona
- [ ] Enviar áudio funciona
- [ ] Enviar documento funciona
- [ ] Template picker funciona
- [ ] Quick reply funciona
- [ ] Mensagem aparece em tempo real (inbound)
- [ ] Auto-takeover pausa bot

### Envio Manual

- [ ] Seleção de contato funciona
- [ ] Validação de número funciona (rejeita inválidos)
- [ ] Rate limit por contato funciona (5s entre msgs)
- [ ] Feedback visual de enviado/pendente/falhou

### Envio Automático (Bot)

- [ ] Bot responde a mensagem inbound
- [ ] Bot segue fluxo correto (step by step)
- [ ] Bot detecta intenção (cadastrar, dúvida, humano)
- [ ] Bot pausa quando consultor envia manual
- [ ] Bot respeita quiet hours
- [ ] Bot respeita anti-ban (quota)
- [ ] Bot não envia duplicatas
- [ ] Bot avança CRM stage automaticamente
- [ ] Follow-up automático funciona
- [ ] Kill switch para bot imediatamente

### Campanhas / Meta Ads

- [ ] Conexão OAuth com Facebook funciona
- [ ] Seleção de assets funciona
- [ ] Criação de campanha funciona
- [ ] Express campaign com IA funciona
- [ ] Métricas sincronizam
- [ ] Wallet mostra saldo correto
- [ ] Auto-pause funciona (gasto > orçamento)
- [ ] Healthcheck mostra problemas

### Integrações

- [ ] Evolution API responde (ping/status)
- [ ] Supabase Realtime conecta
- [ ] Gemini responde (teste simples)
- [ ] MinIO upload funciona
- [ ] Portal Worker responde (health check)
- [ ] Sentry captura erros

### Supabase / Banco

- [ ] RLS bloqueia acesso a dados de outro consultor
- [ ] Admin acessa dados de todos
- [ ] RPCs (has_role, check_send_quota) funcionam
- [ ] Migrations estão atualizadas

### Permissões

- [ ] Consultor vê APENAS seus clientes
- [ ] Consultor vê APENAS suas instâncias
- [ ] Admin vê todos os clientes
- [ ] Super admin vê painel exclusivo
- [ ] Consultor NÃO pode mudar role de outro

### Erros e Edge Cases

- [ ] Sessão expirada mostra erro claro e redirect para login
- [ ] Instância desconectada mostra status visual
- [ ] API timeout mostra feedback ao usuário
- [ ] Página não encontrada (404) mostra NotFound
- [ ] Console sem erros vermelhos em uso normal

### Responsividade (Mobile)

- [ ] Login funciona no celular
- [ ] Dashboard básico funciona
- [ ] Chat WhatsApp funciona (scroll, envio)
- [ ] Kanban funciona (scroll horizontal)
- [ ] Landing page funciona
- [ ] Página do consultor funciona (formulário)

### Produção

- [ ] Build sem erros (`npm run build`)
- [ ] Lint sem erros críticos (`npm run lint`)
- [ ] Testes passam (`npm run test`)
- [ ] Service worker atualiza corretamente
- [ ] HTTPS funcionando
- [ ] Domínio correto
- [ ] Variáveis de produção configuradas
- [ ] Webhooks apontando para produção
