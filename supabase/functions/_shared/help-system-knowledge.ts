export const HELP_SYSTEM_KNOWLEDGE = `
DOCUMENTAÇÃO DE NAVEGAÇÃO DA PLATAFORMA IGREEN

Regras para orientar o usuário:
- Dê passos numerados, curtos e na ordem correta.
- Quando houver uma página indicada, termine com: "Abra: [nome] — [rota]".
- Nunca invente botões, estados, valores, políticas ou resultados.
- Se os dados da operação contradisserem um guia geral, explique a situação real e use o guia apenas como orientação.
- Se faltar informação, faça uma pergunta objetiva. Se não houver solução segura, indique o suporte humano.

Primeiros passos
- Painel: /admin?tab=dashboard. Mostra indicadores, avisos e atalhos.
- Academy: /admin?tab=academy. Reúne aulas, avaliações, progresso e anotações.
- Central de ajuda: /ajuda. Permite buscar guias, ver passos, iniciar orientação na tela e abrir a assistência com IA.

Clientes e CRM
- Clientes interessados: /admin?tab=crm. Lista e organiza novos contatos no funil. Abra um contato para ver conversa e dados; atualize a etapa conforme o avanço.
- Clientes ativos: /admin?tab=crm-clientes. Consulta clientes validados, situação, histórico e dados sincronizados.
- Base de clientes: /admin?tab=clientes. Pesquisa cadastros e documentos por filtros.
- Conversão: /admin?tab=conversao. Localiza oportunidades paradas, mostra contexto e ajuda a retomar o contato.

WhatsApp e assistência de IA
- Conectar ou reconectar: /admin?tab=whatsapp&section=config. Leia o QR Code com o WhatsApp desejado e aguarde o estado conectado antes de testar.
- Conversas: /admin?tab=whatsapp. Permite ler histórico e responder manualmente. Uma intervenção manual pode pausar a automação; reative-a quando quiser devolver o atendimento.
- Base de conhecimento: /admin/conhecimento. Cadastre conteúdo correto, palavras usadas pelos clientes e teste perguntas reais. Atualize o índice quando a tela solicitar.
- Fluxos de atendimento: /admin/fluxos. Edite mensagens, perguntas e caminhos. Salve e simule antes de ativar.
- Fluxo B e personalidade: /admin/fluxo-b. Ajusta estratégia e comportamento do atendimento correspondente.

Captação e anúncios
- Captação: /admin?tab=captacao. Mostra contatos recebidos por anúncios, páginas e outros canais.
- Central de anúncios: /admin?tab=central-anuncios. Atalho comercial para materiais e campanhas.
- Meta Ads: /admin/meta-ads. Gerencia conexão, público, criativos, orçamento, publicação e métricas.
- Campanha reprovada: abra /admin/meta-ads, leia o motivo, valide a conexão e o WhatsApp Business, corrija material ou configuração e envie para nova análise. Não afirme a causa sem ler o motivo real.
- Links: /admin?tab=links. Copie páginas vinculadas à licença e teste o endereço antes de compartilhar.
- Materiais: /admin?tab=materiais. Acessa materiais de divulgação disponíveis.

Automações
- Agendamentos: /admin?tab=agendamentos. Central para mensagens programadas, campanhas, pós-venda, rodízios e histórico.
- Motor de cadência: /admin/motor. Configura tentativas por WhatsApp, ligação e SMS, intervalos, limites e horários.
- Reaquecimento: /admin/reaquecimento. Retoma contatos parados com mensagens e intervalos controlados.
- Central operacional: /admin/agendamentos-central. Reúne textos e configurações operacionais avançadas.
- Ligações: /admin?tab=voz. Gerencia campanhas e recursos de voz.
- Estúdio de áudio: /admin?tab=audio-studio. Cria e organiza materiais de áudio.

Produtos e vendas
- Produtos e vendas: /admin?tab=produtos. Cria oportunidades, propostas e acompanha etapas comerciais.
- Projeto solar: /admin/solar-design. Analisa endereço e telhado, ajusta painéis e salva o estudo para uso em proposta.
- Parceiros: /admin?tab=parceiros. Cadastra indicadores, links exclusivos, notificações e rodízios.
- Agendamentos comerciais: /admin?tab=agendamentos. Organiza atividades e envios relacionados ao atendimento.

Financeiro e pós-venda
- Financeiro: /admin?tab=financeiro. Reúne carteira, movimentações, recebíveis e comissões. Sempre confirme período e situação antes de explicar um valor.
- Pós-venda: /admin?tab=crm-clientes. Acompanha aprovação, assinatura, devolutivas e contatos posteriores.
- Carteira de anúncios: fica no contexto financeiro e de Meta Ads. Use os dados atuais do consultor para informar saldo; não invente mínimos ou taxas.

Diagnóstico e suporte
- Saúde do atendimento: /admin/saude-bot.
- Saúde de produção: /admin/saude-producao.
- Monitor do portal: /admin/portal-monitor.
- Reconciliação iGreen: /admin/recon.
- Protocolos: /admin/protocolos.
- Central de ajuda: /ajuda.
- Para suporte com contexto, use o menu flutuante de ajuda e escolha "Perguntar ao suporte com IA".
`;

export function formatHelpArticles(rows: Array<{ category?: string; title?: string; body?: string; video_url?: string | null }>) {
  if (!rows.length) return "";
  return `\nARTIGOS PUBLICADOS PELO ADMINISTRADOR\n${rows.map((row) => `\n[${row.category || "Geral"}] ${row.title || "Sem título"}\n${row.body || ""}${row.video_url ? `\nVídeo: ${row.video_url}` : ""}`).join("\n")}`;
}
