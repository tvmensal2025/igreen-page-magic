import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Search, ChevronRight, BookOpen, Bell, Sparkles, Eye, EyeOff,
  Home, LayoutDashboard, MessageSquare, Users, Zap, Bot, Heart,
  Brain, Flame, RefreshCw, Target, Megaphone, Sun, Shield, AlertTriangle,
  Info, Lightbulb, CheckCircle2, HelpCircle, PanelLeftClose, ArrowUp,
  Link as LinkIcon, Image as ImageIcon, Rocket, Lock, Wallet, Activity,
  Cog, Play, Star, MousePointerClick,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import heroImg from "@/assets/tutorial/hero.jpg";
import adminImg from "@/assets/tutorial/admin.jpg";
import whatsappImg from "@/assets/tutorial/whatsapp.jpg";
import superadminImg from "@/assets/tutorial/superadmin.jpg";

/* =========================================================================
 * Small primitives
 * =======================================================================*/

type CalloutKind = "tip" | "warn" | "leigo" | "when" | "info";

const calloutStyle: Record<CalloutKind, { bg: string; border: string; icon: ReactNode; label: string }> = {
  tip:   { bg: "bg-emerald-50",  border: "border-emerald-300",  icon: <Lightbulb className="w-4 h-4" />,   label: "Dica" },
  warn:  { bg: "bg-amber-50",    border: "border-amber-300",    icon: <AlertTriangle className="w-4 h-4" />, label: "Atenção" },
  leigo: { bg: "bg-sky-50",      border: "border-sky-300",      icon: <BookOpen className="w-4 h-4" />,     label: "Para leigos" },
  when:  { bg: "bg-violet-50",   border: "border-violet-300",   icon: <CheckCircle2 className="w-4 h-4" />, label: "Quando usar" },
  info:  { bg: "bg-slate-50",    border: "border-slate-300",    icon: <Info className="w-4 h-4" />,         label: "Nota" },
};

function Callout({ kind = "tip", title, children }: { kind?: CalloutKind; title?: string; children: ReactNode }) {
  const s = calloutStyle[kind];
  return (
    <div className={`my-4 rounded-xl border ${s.border} ${s.bg} p-4 text-sm text-slate-800`}>
      <div className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
        {s.icon}
        <span>{title ?? s.label}</span>
      </div>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex gap-4 my-3">
      <div className="flex-none w-8 h-8 rounded-full bg-emerald-600 text-white text-sm font-bold flex items-center justify-center">
        {n}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-900">{title}</div>
        {children && <div className="text-slate-700 text-sm mt-1 leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

function ButtonRow({ items }: { items: Array<{ icon?: ReactNode; name: string; desc: string }> }) {
  return (
    <ul className="my-3 divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 items-start p-3 bg-white">
          <div className="mt-0.5 text-emerald-600">{it.icon ?? <MousePointerClick className="w-4 h-4" />}</div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 text-sm">{it.name}</div>
            <div className="text-slate-600 text-sm leading-relaxed">{it.desc}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Figure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="my-5">
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-2xl border border-slate-200 shadow-sm bg-white" />
      {caption && <figcaption className="text-xs text-slate-500 mt-2 text-center">{caption}</figcaption>}
    </figure>
  );
}

/* =========================================================================
 * Section wrapper (registers id for TOC)
 * =======================================================================*/

interface SectionDef {
  id: string;
  title: string;
  icon: ReactNode;
  area: "Público" | "Consultor" | "Admin" | "Super Admin" | "Geral";
}

function Section({ def, children }: { def: SectionDef; children: ReactNode }) {
  const areaColor: Record<SectionDef["area"], string> = {
    "Público": "bg-sky-100 text-sky-800",
    "Consultor": "bg-emerald-100 text-emerald-800",
    "Admin": "bg-violet-100 text-violet-800",
    "Super Admin": "bg-rose-100 text-rose-800",
    "Geral": "bg-slate-100 text-slate-800",
  };
  return (
    <section id={def.id} className="scroll-mt-24 py-10 border-b border-slate-200 last:border-0">
      <div className="flex items-center gap-3 mb-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${areaColor[def.area]}`}>
          {def.area}
        </span>
        <span className="text-emerald-600">{def.icon}</span>
      </div>
      <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{def.title}</h2>
      <div className="mt-4 prose prose-slate max-w-none prose-p:leading-relaxed prose-p:text-slate-700 prose-strong:text-slate-900">
        {children}
      </div>
    </section>
  );
}

/* =========================================================================
 * Content sections
 * =======================================================================*/

const sections: Array<{ def: SectionDef; content: ReactNode }> = [
  {
    def: { id: "boas-vindas", title: "1. Boas-vindas — como usar este tutorial", icon: <BookOpen className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <p>Este é o guia oficial da plataforma <strong>iGreen Cloud</strong>. Foi feito para <em>qualquer pessoa</em>: consultor iniciante, admin experiente ou super admin técnico.</p>
        <Figure src={heroImg} alt="Pessoa aprendendo a plataforma no notebook" caption="Não precisa ser técnico. Vá lendo do começo ou pulando pelo índice ao lado." />
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Índice à esquerda</strong>: clique em qualquer item para pular direto.</li>
          <li><strong>Busca no topo</strong>: digite uma palavra (ex.: "sino", "fluxo", "meta") para encontrar rápido.</li>
          <li><strong>Selos coloridos</strong> em cada seção mostram quem usa aquela parte: Público, Consultor, Admin ou Super Admin.</li>
          <li>Todas as instruções vêm em 4 blocos: <em>O que é</em>, <em>Para que serve</em>, <em>Como usar</em>, <em>Cuidados</em>.</li>
        </ul>
        <Callout kind="leigo">
          Não se assuste com nomes técnicos. Sempre que aparecer uma palavra estranha, ela está explicada no <a className="text-emerald-700 underline" href="#glossario">Glossário</a>.
        </Callout>
      </>
    ),
  },

  {
    def: { id: "glossario", title: "2. Glossário rápido", icon: <BookOpen className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <ButtonRow items={[
          { name: "Consultor(a)", desc: "Pessoa que divulga a iGreen e traz clientes. Cada consultor tem um link tipo igreen.cloud/nome." },
          { name: "Licenciado(a)", desc: "Consultor com licença — pode montar time e ganhar sobre a rede." },
          { name: "Lead", desc: "Contato interessado que ainda não fechou. Vira 'cliente' quando assina." },
          { name: "Fluxo", desc: "Roteiro automático de mensagens do WhatsApp. Uma sequência de perguntas e respostas do bot." },
          { name: "Bot", desc: "Robô que conversa no WhatsApp seguindo o fluxo. Faz o primeiro atendimento sozinho." },
          { name: "CRM", desc: "Painel onde você vê todas as conversas, o funil e o status de cada lead." },
          { name: "Cron", desc: "Tarefa que roda sozinha de tempos em tempos no servidor (ex.: uma vez por hora)." },
          { name: "Meta Ads", desc: "Anúncios do Facebook e Instagram." },
          { name: "PWA", desc: "Modo de instalar o site como se fosse um app no celular ou computador." },
          { name: "RLS", desc: "Regra de segurança do banco de dados — garante que você só vê o que é seu." },
        ]} />
      </>
    ),
  },

  /* ---------------------- PÚBLICO ---------------------- */
  {
    def: { id: "site-publico", title: "3. Site público — o que o cliente vê", icon: <Home className="w-5 h-5" />, area: "Público" },
    content: (
      <>
        <p>Antes de logar, existem várias páginas <strong>públicas</strong>. Elas são a "vitrine" da iGreen. Qualquer pessoa com o link entra.</p>

        <h3 className="text-xl font-bold mt-6" id="pagina-consultor">3.1 Página da consultora — <code>/nome-do-consultor</code></h3>
        <p>É a "landing page" pessoal. Cada consultor tem a sua. Mostra foto, benefícios, botão de WhatsApp e formulário de simulação.</p>
        <ButtonRow items={[
          { name: "Botão WhatsApp flutuante", desc: "Abre uma conversa direto com a consultora. Aparece em todas as seções, canto inferior direito." },
          { name: "Formulário 'Simular economia'", desc: "Captura nome, telefone e conta de luz do lead. Vira lead novo no CRM da consultora." },
          { name: "Menu 'Sobre / Vantagens / Como funciona'", desc: "Rola a página até cada seção. É só apresentação — não muda nada." },
          { name: "Selo de estado (SP, MG…)", desc: "Mostra que a iGreen atende aquele estado. Clicando abre mais detalhes." },
        ]} />

        <h3 className="text-xl font-bold mt-6" id="pagina-licenciado">3.2 Página do licenciado — <code>/licenciado/nome</code></h3>
        <p>Versão profissional voltada para quem quer <strong>ser</strong> licenciado (montar equipe). Tem plano de carreira, comissões e produtos Conexão.</p>
        <Callout kind="when">
          Use quando conversar com alguém que quer trabalhar com você, não só ser cliente.
        </Callout>

        <h3 className="text-xl font-bold mt-6" id="cadastro">3.3 Cadastro de cliente — <code>/cadastro/nome</code></h3>
        <p>Formulário completo para o cliente virar assinante. Pede dados pessoais, endereço e a conta de luz. Depois de enviar, cai no funil da consultora.</p>

        <h3 className="text-xl font-bold mt-6" id="conexao">3.4 Páginas Conexão (produtos)</h3>
        <p>São 9 páginas de produto — cada uma vende um serviço diferente da iGreen. Todas têm o mesmo formato: hero, benefícios, preço, botão WhatsApp.</p>
        <ButtonRow items={[
          { name: "Conexão Telecom", desc: "Chip de celular com internet ilimitada." },
          { name: "Conexão Seguros", desc: "Seguros diversos (auto, vida)." },
          { name: "Conexão Solar", desc: "Energia solar por assinatura." },
          { name: "Conexão Placas", desc: "Instalação de placas solares." },
          { name: "Conexão Livre", desc: "Energia livre por assinatura, sem obra." },
          { name: "Conexão Club", desc: "Clube de descontos pessoa física." },
          { name: "Conexão Club PJ", desc: "Clube de descontos pessoa jurídica." },
          { name: "Conexão Green", desc: "Assinatura verde combinada." },
          { name: "Conexão Expansão", desc: "Programa de expansão / franquia." },
        ]} />

        <h3 className="text-xl font-bold mt-6" id="proposta">3.5 Proposta pública — <code>/proposta/token</code></h3>
        <p>Link único gerado pelo admin. Mostra a proposta comercial pronta para o cliente aprovar. Depois de aberta, o consultor vê no CRM que o cliente visualizou.</p>

        <h3 className="text-xl font-bold mt-6" id="outras-publicas">3.6 CRM, Assistente, Instalar, Política</h3>
        <ButtonRow items={[
          { name: "/crm", desc: "Landing do CRM iGreen. Explica o que é e como funciona o painel." },
          { name: "/assistente", desc: "Página do Assistente IA — chatbot público que tira dúvidas sobre a iGreen." },
          { name: "/install", desc: "Ensina a instalar o app no celular (PWA). Aparece o botão 'Instalar app'." },
          { name: "/politica-privacidade", desc: "Termos e privacidade. Obrigatório por lei (LGPD)." },
          { name: "/reset", desc: "Página de emergência: limpa o cache local do app se estiver com bug." },
        ]} />
      </>
    ),
  },

  /* ---------------------- LOGIN ---------------------- */
  {
    def: { id: "login", title: "4. Login e primeiro acesso", icon: <Lock className="w-5 h-5" />, area: "Consultor" },
    content: (
      <>
        <p>A porta de entrada é <code>/auth</code>. Ali você faz login ou cria a conta de consultor.</p>
        <Step n={1} title="Abrir /auth">Digite igreen.cloud/auth no navegador ou clique em "Entrar" em qualquer página.</Step>
        <Step n={2} title="Escolher a aba">Duas abas: <strong>Entrar</strong> (já tem conta) ou <strong>Criar conta</strong> (primeiro acesso).</Step>
        <Step n={3} title="E-mail + senha">Use o e-mail cadastrado. Se esqueceu, clique em "Esqueci minha senha" — chega um link no e-mail.</Step>
        <Step n={4} title="Instalar como app (opcional)">No celular, aparece um banner "Adicionar à tela inicial". No computador, use o menu do navegador → "Instalar aplicativo".</Step>
        <Callout kind="warn">
          Se aparecer erro <strong>504</strong> ou <strong>CORS</strong> na tela de login, o servidor está sobrecarregado. Aguarde 30 segundos e tente de novo. Se persistir, avise o suporte.
        </Callout>
      </>
    ),
  },

  /* ---------------------- TOPBAR ---------------------- */
  {
    def: { id: "topbar", title: "5. Barra do topo do Admin — o que faz cada ícone", icon: <PanelLeftClose className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Depois de logar, você entra em <code>/admin</code>. Em cima aparece a <strong>barra do topo</strong> com 5 controles importantes. Vamos por cada um.</p>
        <Figure src={adminImg} alt="Ilustração do painel do admin" caption="A barra do topo é sua central: sidebar, privacidade, IA, notificações e perfil." />

        <h3 className="text-xl font-bold mt-6" id="topbar-sidebar">5.1 Botão de recolher / expandir menu</h3>
        <p><strong>Ícone:</strong> painel com seta. <strong>O que faz:</strong> esconde ou mostra o menu lateral (aumenta a área de trabalho).</p>
        <Callout kind="tip">No celular, esse mesmo botão abre o menu em cima da tela.</Callout>

        <h3 className="text-xl font-bold mt-6" id="topbar-olho">5.2 Olho — modo privacidade</h3>
        <p><strong>Ícone:</strong> <Eye className="inline w-4 h-4 align-text-bottom" /> / <EyeOff className="inline w-4 h-4 align-text-bottom" />. <strong>O que faz:</strong> substitui todos os números sensíveis (faturamento, telefones de clientes, comissões) por asteriscos.</p>
        <Callout kind="when">
          Ative em <strong>apresentações, reuniões ou vídeos</strong> — assim ninguém vê os dados dos seus clientes. Desativa com um clique.
        </Callout>

        <h3 className="text-xl font-bold mt-6" id="topbar-estrela">5.3 Estrela — Assistente de IA</h3>
        <p><strong>Ícone:</strong> <Sparkles className="inline w-4 h-4 align-text-bottom" />. <strong>O que faz:</strong> abre um chat lateral com a IA da iGreen (o <em>AIChatPanel</em>).</p>
        <ButtonRow items={[
          { icon: <Sparkles className="w-4 h-4" />, name: "Perguntar como usar a plataforma", desc: "Ex.: 'como crio um fluxo?'. A IA responde com o passo a passo." },
          { icon: <MessageSquare className="w-4 h-4" />, name: "Gerar textos e mensagens", desc: "Peça: 'escreva uma mensagem de boas-vindas para cliente novo'." },
          { icon: <Brain className="w-4 h-4" />, name: "Resumir conversas do WhatsApp", desc: "Cole uma conversa longa e peça um resumo." },
        ]} />
        <Callout kind="warn">Cada pergunta consome créditos da sua carteira IA (mostrado no card "AI Cost"). Perguntas curtas custam pouco; textos longos custam mais.</Callout>

        <h3 className="text-xl font-bold mt-6" id="topbar-sino">5.4 Sino — Notificações</h3>
        <p><strong>Ícone:</strong> <Bell className="inline w-4 h-4 align-text-bottom" />. <strong>O que faz:</strong> abre a lista de avisos (novos leads, mensagens, alertas do sistema, aprovações pendentes).</p>
        <ButtonRow items={[
          { name: "Bolinha vermelha", desc: "Quantidade de notificações não lidas." },
          { name: "Marcar todas como lidas", desc: "Botão no topo do painel. Zera o contador." },
          { name: "Apagar uma", desc: "Ícone de lixeira ao lado de cada aviso." },
          { name: "Clicar no aviso", desc: "Leva direto para a tela relacionada (ex.: lead novo → conversa)." },
        ]} />

        <h3 className="text-xl font-bold mt-6" id="topbar-avatar">5.5 Avatar / trocar conta / sair</h3>
        <ButtonRow items={[
          { name: "Foto de perfil", desc: "Menu com 'Editar dados', 'Trocar senha', 'Sair'." },
          { name: "Sair (logout)", desc: "Encerra a sessão. Precisa logar de novo para voltar." },
        ]} />
      </>
    ),
  },

  /* ---------------------- SIDEBAR ---------------------- */
  {
    def: { id: "sidebar", title: "6. Menu lateral do Admin — item a item", icon: <LayoutDashboard className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>O menu lateral (<em>sidebar</em>) é sua bússola. Cada item leva a uma área. Nomes podem variar levemente conforme seu nível.</p>
        <ButtonRow items={[
          { icon: <LayoutDashboard className="w-4 h-4" />, name: "Dashboard", desc: "Visão geral: leads, vendas, comissões, gráficos." },
          { icon: <MessageSquare className="w-4 h-4" />, name: "Clientes WhatsApp", desc: "Todas as conversas, funil, envio em massa. Coração da operação." },
          { icon: <Zap className="w-4 h-4" />, name: "Fluxos", desc: "Editor visual dos robôs do WhatsApp." },
          { icon: <Bot className="w-4 h-4" />, name: "Fluxo B", desc: "Fluxo alternativo para teste A/B." },
          { icon: <Heart className="w-4 h-4" />, name: "Saúde do Bot / Produção", desc: "Monitor de performance." },
          { icon: <Brain className="w-4 h-4" />, name: "Conhecimento (FAQ + IA)", desc: "Ensina a IA a responder as dúvidas certas." },
          { icon: <Flame className="w-4 h-4" />, name: "Reaquecimento", desc: "Reengajar leads frios automaticamente." },
          { icon: <RefreshCw className="w-4 h-4" />, name: "Reconciliação iGreen", desc: "Cruza clientes do WhatsApp com base oficial iGreen." },
          { icon: <Target className="w-4 h-4" />, name: "Conversão", desc: "Análise de quem virou cliente e por quê." },
          { icon: <Megaphone className="w-4 h-4" />, name: "Meta Ads", desc: "Anúncios Facebook/Instagram." },
          { icon: <Sun className="w-4 h-4" />, name: "Solar Design", desc: "Simulador 3D de instalação solar." },
          { icon: <Shield className="w-4 h-4" />, name: "Super Admin", desc: "Só para nível máximo — controles globais." },
        ]} />
      </>
    ),
  },

  /* ---------------------- Admin - abas ---------------------- */
  {
    def: { id: "admin-dashboard", title: "7. Admin › Dashboard", icon: <LayoutDashboard className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Primeira tela ao entrar no admin. É o "raio-X" do seu negócio.</p>
        <ButtonRow items={[
          { name: "Cards de topo (Leads, Clientes, Comissão…)", desc: "Números do mês atual comparados ao mês anterior. Setinha verde = subindo." },
          { name: "Gráfico de performance", desc: "Linha do tempo de novos leads/conversões. Filtro de período no canto superior direito." },
          { name: "Mapa de geografia", desc: "Onde estão seus leads no Brasil. Cor mais escura = mais leads." },
          { name: "Top consumidores", desc: "Ranking dos clientes que mais consomem energia — foco para vendas maiores." },
          { name: "Retenção", desc: "Percentual de clientes que continuam ativos mês a mês." },
          { name: "AI Cost", desc: "Quanto você gastou com IA no período. Se explodir, revise fluxos que chamam IA." },
        ]} />
        <Callout kind="tip">Os gráficos respeitam o <strong>modo privacidade</strong> (olho). Bom para gravar tela sem expor números.</Callout>
      </>
    ),
  },

  {
    def: { id: "admin-dados", title: "8. Admin › Dados (perfil + Sincronizar agora)", icon: <Cog className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Aqui você configura <strong>quem você é</strong> na plataforma e roda sincronizações manuais.</p>
        <ButtonRow items={[
          { name: "Foto de perfil", desc: "Aparece na sua página pública e no CRM." },
          { name: "Nome / apelido de link", desc: "Muda a URL da sua página. Ex.: 'joao' → igreen.cloud/joao." },
          { name: "Telefone / WhatsApp", desc: "Número que recebe leads. Precisa ser o que está conectado ao bot." },
          { name: "Bio / apresentação", desc: "Texto curto que aparece na página pública." },
          { name: "Conexão iGreen (código)", desc: "Amarração com o portal oficial da iGreen para pegar clientes e comissões." },
          { name: "Salvar dados", desc: "Grava tudo. Sem clicar aqui, as mudanças não persistem." },
        ]} />
        <h3 className="text-xl font-bold mt-6" id="sincronizar-agora">Sincronizar agora (SyncAllPanel)</h3>
        <p>Antes, várias sincronizações rodavam sozinhas o dia todo, sobrecarregando o servidor. Agora ficam quietas até você <strong>clicar em "Sincronizar agora"</strong>.</p>
        <Callout kind="when">
          Rode <strong>1x por dia</strong> (de manhã) ou quando precisar de dados fresquinhos para uma reunião/relatório.
        </Callout>
        <ButtonRow items={[
          { name: "Facebook Ads (métricas)", desc: "Puxa gastos, cliques e conversões dos anúncios do dia." },
          { name: "Facebook Ads (criativos)", desc: "Baixa imagens/vídeos e textos dos anúncios." },
          { name: "iGreen (clientes)", desc: "Atualiza a base de clientes oficial vindo do portal iGreen." },
          { name: "IA (aprendizado)", desc: "Consolida o que a IA aprendeu nas conversas do dia." },
          { name: "Limpeza de webhooks", desc: "Apaga registros antigos para deixar o banco leve." },
          { name: "Bot Follow-ups", desc: "Envia lembretes para leads parados. Verifique o texto antes." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "admin-links", title: "9. Admin › Links / QR / Panfleto", icon: <LinkIcon className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Central de divulgação. Aqui você gera links prontos para compartilhar.</p>
        <ButtonRow items={[
          { name: "Card de cada produto", desc: "Botão 'Copiar link' e 'Ver'. Cola no WhatsApp/Instagram." },
          { name: "QR Code", desc: "Baixa como imagem. Ótimo para panfleto físico e adesivo de carro." },
          { name: "Panfleto (PanfletoModal)", desc: "Gera PDF personalizado com sua foto + QR. Escolha modelo e clique 'Baixar PDF'." },
          { name: "Link curto de rastreio", desc: "Cada clique é contado no Dashboard, aba 'Links'." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "admin-materiais", title: "10. Admin › Materiais", icon: <ImageIcon className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Biblioteca oficial de imagens, vídeos e textos aprovados pela iGreen para você usar em redes sociais.</p>
        <ButtonRow items={[
          { name: "Filtro por categoria", desc: "Institucional, promoções, datas comemorativas, etc." },
          { name: "Baixar", desc: "Salva o arquivo no seu dispositivo." },
          { name: "Compartilhar", desc: "Abre menu nativo para mandar direto no WhatsApp/Instagram." },
        ]} />
        <Callout kind="warn">Use só material daqui em anúncios pagos. Material externo pode gerar bloqueio na iGreen.</Callout>
      </>
    ),
  },

  {
    def: { id: "admin-preview", title: "11. Admin › Preview da página pública", icon: <Eye className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Mostra <strong>como o cliente vê</strong> sua página. Use antes de compartilhar link novo, especialmente depois de mudar foto ou bio.</p>
        <ButtonRow items={[
          { name: "Trocar entre desktop/mobile", desc: "Botões no topo do preview. Sempre verifique no mobile — 80% dos leads vêm de celular." },
          { name: "Abrir em nova aba", desc: "Abre a página real, para conferir 100%." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "admin-rede", title: "12. Admin › Rede / Ranking do time", icon: <Users className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Se você é licenciado, aqui vê sua equipe.</p>
        <ButtonRow items={[
          { name: "Árvore da rede", desc: "Estrutura hierárquica: você → licenciados → consultores." },
          { name: "Ranking", desc: "Quem vendeu mais no mês. Bom para reconhecer top performers." },
          { name: "Convidar novo", desc: "Gera link de convite para adicionar consultor à sua rede." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "admin-aiagent", title: "13. Admin › AI Agent", icon: <Sparkles className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Configura o "cérebro" da IA que atende no WhatsApp. Aqui você diz <strong>como</strong> a IA deve responder.</p>
        <ButtonRow items={[
          { name: "Persona / tom de voz", desc: "Formal, informal, animado. Escreva 1-2 frases." },
          { name: "Instruções principais", desc: "Regras do que a IA pode e não pode fazer." },
          { name: "Modelo (gpt-4o / gemini…)", desc: "Padrão já configurado. Só mude se souber o que faz." },
          { name: "Limite mensal de gasto", desc: "Trava para a carteira IA não estourar. Recomendado sempre configurar." },
          { name: "Salvar", desc: "Aplica em todos os fluxos que usam IA." },
        ]} />
        <Callout kind="warn">Mudar prompt afeta <strong>todos</strong> os clientes que estiverem em conversa. Teste no seu próprio WhatsApp antes.</Callout>
      </>
    ),
  },

  {
    def: { id: "whatsapp-clients", title: "14. Admin › Clientes WhatsApp", icon: <MessageSquare className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>É <strong>a</strong> tela mais usada. Todas as conversas, filtros e envio em massa.</p>
        <Figure src={whatsappImg} alt="Ilustração de conversas WhatsApp com fluxo" />
        <ButtonRow items={[
          { name: "Aba 'Todas' / 'Não lidas' / 'iGreen'", desc: "Filtra por status. 'iGreen' = já é cliente confirmado." },
          { name: "Busca por nome/telefone", desc: "Campo no topo. Aceita parte do nome." },
          { name: "Selecionar em massa (checkbox)", desc: "Marca vários contatos para agir em conjunto." },
          { name: "Enviar mensagem em massa", desc: "Escreva texto ou grave áudio. Escolhe o público pelos filtros." },
          { name: "Envio de áudio (AudioStudio)", desc: "Grava direto no navegador. Suporta pré-visualização." },
          { name: "Marcar como cliente iGreen", desc: "Estrela verde. Passa o contato para a base oficial." },
          { name: "Conversa individual", desc: "Ver histórico, digitar resposta, transferir para humano, congelar bot." },
          { name: "Botão 'Conversas vencedoras'", desc: "IA sugere as conversas com maior chance de fechar hoje." },
        ]} />
        <Callout kind="warn">Envio em massa consome cota do WhatsApp. Se enviar demais em pouco tempo, o número pode ser bloqueado. Recomendação: no máximo 200 disparos por hora, com texto variado.</Callout>
      </>
    ),
  },

  {
    def: { id: "fluxos", title: "15. Admin › Fluxos (editor visual)", icon: <Zap className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>O <strong>FluxoBuilder</strong> é onde você desenha a conversa do bot. Pense em quadradinhos ligados por setinhas — cada quadradinho é uma ação.</p>
        <ButtonRow items={[
          { name: "Paleta de nós (esquerda)", desc: "Arrasta para o canvas: Mensagem, Pergunta, Condição, Chamada de IA, Espera, Transferir, Encerrar." },
          { name: "Canvas (centro)", desc: "Área onde os nós ficam. Zoom com scroll, arrastar com botão do meio ou espaço." },
          { name: "Propriedades (direita)", desc: "Quando clica num nó, aparecem os campos para editar (texto, opções, IA prompt)." },
          { name: "Testar (▶)", desc: "Simula a conversa dentro do próprio editor. Não gasta cota real." },
          { name: "Publicar", desc: "Sobe a nova versão para produção. Todos os leads novos entram nela." },
          { name: "Versões / Rollback", desc: "Menu com histórico. Dá para voltar se estragar." },
        ]} />
        <Callout kind="tip">Comece pequeno: 3-4 nós (saudação → pergunta → transferir). Depois vá refinando.</Callout>
      </>
    ),
  },

  {
    def: { id: "fluxo-b", title: "16. Admin › Fluxo B (teste A/B)", icon: <Bot className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Uma cópia paralela do fluxo principal. Ideal para testar uma nova abordagem em <strong>metade</strong> dos leads sem risco.</p>
        <ButtonRow items={[
          { name: "% de tráfego para B", desc: "Slider de 0-100%. Comece com 20%." },
          { name: "Editor (igual ao A)", desc: "Mesmos nós e propriedades." },
          { name: "Comparativo de conversão", desc: "Após 1-2 semanas, ver qual venceu e promover para principal." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "saude-bot", title: "17. Admin › Saúde do Bot / Produção / Portal Monitor", icon: <Heart className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Painéis de <strong>monitoramento</strong>. Ficam verdes se está tudo bem, vermelhos quando dá problema.</p>
        <ButtonRow items={[
          { name: "Saúde do Bot", desc: "Status da instância WhatsApp: conectada? mandando mensagem?" },
          { name: "Saúde de Produção", desc: "Métricas de performance geral: latência, erros, envios." },
          { name: "Portal Monitor", desc: "Estado do portal iGreen (integração externa)." },
          { name: "Reconectar WhatsApp", desc: "Botão para forçar reconexão se cair." },
          { name: "Ler QR Code", desc: "Aparece quando precisa parear celular de novo." },
        ]} />
        <Callout kind="warn">Se a bolinha do WhatsApp ficar vermelha, ninguém está recebendo mensagens. Prioridade máxima.</Callout>
      </>
    ),
  },

  {
    def: { id: "conhecimento", title: "18. Admin › Conhecimento (FAQ + IA)", icon: <Brain className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>O "livro" que a IA lê antes de responder. Quanto melhor o conteúdo aqui, mais certeira ela fica.</p>
        <ButtonRow items={[
          { name: "Adicionar FAQ", desc: "Pergunta + Resposta. Escreva como o cliente perguntaria." },
          { name: "Aba IA", desc: "Textos livres (regras da empresa, tabela de preços). A IA usa como referência." },
          { name: "Testar pergunta", desc: "Digita uma pergunta e vê a resposta que a IA daria — bom para calibrar." },
          { name: "Sincronizar com bot", desc: "Após salvar, publique para o bot passar a usar." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "reaquecimento", title: "19. Admin › Reaquecimento", icon: <Flame className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Reengaja leads que não respondem há X dias.</p>
        <ButtonRow items={[
          { name: "Público-alvo", desc: "Filtros: sem resposta há N dias, status, produto de interesse." },
          { name: "Mensagens em cadência", desc: "1ª mensagem hoje, 2ª em 3 dias, 3ª em 7 dias — configurável." },
          { name: "Kill switch", desc: "Botão vermelho: pausa TUDO imediatamente. Use se algo sair errado." },
          { name: "Simular", desc: "Mostra quantos leads seriam impactados antes de disparar." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "recon", title: "20. Admin › Reconciliação iGreen", icon: <RefreshCw className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Cruza clientes do WhatsApp com a base oficial iGreen. Detecta duplicidades, faltas e divergências.</p>
        <ButtonRow items={[
          { name: "Rodar reconciliação", desc: "Botão manual — antes rodava em cron, agora fica sob seu controle." },
          { name: "Lista de divergências", desc: "Ver o que está diferente entre bases e decidir." },
          { name: "Aprovar / Corrigir", desc: "Aplica correções no CRM." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "conversao", title: "21. Admin › Conversão", icon: <Target className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Análise profunda de quem virou cliente. Mostra o funil, taxa de conversão por etapa e onde os leads travam.</p>
        <ButtonRow items={[
          { name: "Funil visual", desc: "Barras horizontais: entrada → interesse → proposta → fechamento." },
          { name: "Classificar", desc: "Reprocessa leads recentes e reclassifica automaticamente." },
          { name: "Exportar CSV", desc: "Baixa para análise externa." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "meta-ads", title: "22. Admin › Meta Ads", icon: <Megaphone className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Controla anúncios do Facebook e Instagram sem sair da iGreen.</p>
        <ButtonRow items={[
          { name: "Conectar conta", desc: "OAuth com Facebook. Peça permissão de anúncios." },
          { name: "Ver criativos", desc: "Lista de imagens/vídeos em uso. Ver métricas por criativo." },
          { name: "Comparativo A/B", desc: "Compara CPL e conversão entre criativos." },
          { name: "Rotacionar criativos", desc: "Antes automático; agora manual — clique quando quiser trocar." },
          { name: "Sincronizar métricas", desc: "Puxa números atualizados. Botão manual." },
        ]} />
      </>
    ),
  },

  {
    def: { id: "solar", title: "23. Admin › Solar Design", icon: <Sun className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Simulador 3D de instalação de placas solares. Ferramenta para propostas técnicas.</p>
        <ButtonRow items={[
          { name: "Endereço do imóvel", desc: "Digite e o mapa carrega o telhado." },
          { name: "Desenhar telhado", desc: "Clique nos cantos para criar o polígono." },
          { name: "Adicionar módulos", desc: "Placas aparecem posicionadas automaticamente. Arraste para ajustar." },
          { name: "Estimativa de geração", desc: "kWh/mês estimado com base na região." },
          { name: "Salvar proposta", desc: "Gera link público para o cliente ver o 3D." },
        ]} />
      </>
    ),
  },

  /* ---------------------- SUPER ADMIN ---------------------- */
  {
    def: { id: "super-admin", title: "24. Super Admin — visão geral", icon: <Shield className="w-5 h-5" />, area: "Super Admin" },
    content: (
      <>
        <Figure src={superadminImg} alt="Escudo simbolizando super admin" />
        <p>Área <strong>restrita</strong>. Só pessoas com role <code>super_admin</code> no banco de dados acessam. Controla a plataforma inteira, não apenas seu perfil.</p>
        <Callout kind="warn">Cada botão aqui afeta <strong>TODOS</strong> os usuários. Nunca clique em nada sem entender.</Callout>
      </>
    ),
  },

  {
    def: { id: "super-paineis", title: "25. Super Admin — painéis um a um", icon: <Cog className="w-5 h-5" />, area: "Super Admin" },
    content: (
      <>
        <ButtonRow items={[
          { name: "AI Control Panel", desc: "Liga/desliga IA globalmente. Troca modelo padrão." },
          { name: "AI Audit Panel", desc: "Log de tudo que a IA respondeu — para auditoria e ajuste." },
          { name: "AI Knowledge Panel", desc: "Base de conhecimento global (compartilhada por todos)." },
          { name: "Bot Global Kill Switch", desc: "Botão vermelho: para TODOS os bots no ato. Emergência." },
          { name: "Bot Funnel Panel", desc: "Funil consolidado de todos os consultores." },
          { name: "Ad Managers Tab", desc: "Contas de anúncios de todos os licenciados." },
          { name: "Ad Templates Panel", desc: "Modelos de anúncio aprovados." },
          { name: "AB Results Panel", desc: "Resultado dos testes A/B em andamento." },
          { name: "Captação Tab", desc: "Painel de captação de novos consultores." },
          { name: "CRM Analytics Tab", desc: "Analytics agregado do CRM." },
          { name: "FAQ Comparativo Panel", desc: "Compara FAQs de diferentes consultores." },
          { name: "Flow Template Approval", desc: "Aprova/reprova fluxos submetidos pelos consultores." },
          { name: "Infra Health Panel", desc: "Saúde de servidores, banco, filas." },
          { name: "Learned Patterns Panel", desc: "Padrões que a IA aprendeu — dá para aprovar/descartar." },
          { name: "Phone Reset Button", desc: "Zera o número WhatsApp de um consultor (para trocar chip)." },
          { name: "Resolver Strict Mode Toggle", desc: "Modo rigoroso da IA — responde só se tiver certeza." },
          { name: "Rollout Panel", desc: "Distribui novas features em % (10% → 50% → 100%)." },
          { name: "Solar Module Panel", desc: "Catálogo de placas solares disponíveis." },
          { name: "Stuck Leads Widget", desc: "Leads travados que precisam de humano." },
          { name: "System Health Panel", desc: "Panorama de erros e alertas do sistema." },
          { name: "WhatsApp Instance Health Card", desc: "Estado de cada instância WhatsApp na plataforma." },
          { name: "Worker Phase Timeline", desc: "Linha do tempo do trabalhador em fases." },
          { name: "DevTools Block Toggle", desc: "Bloqueia F12/inspecionar para usuários finais." },
          { name: "Audit Log Panel", desc: "Log de ações administrativas (quem fez o quê)." },
          { name: "Suporte Remoto (/super-admin/suporte)", desc: "Assume a tela de um consultor com permissão para ajudar." },
        ]} />
      </>
    ),
  },

  /* ---------------------- Sync ---------------------- */
  {
    def: { id: "syncs", title: "26. Sincronizações manuais — o que cada botão dispara", icon: <RefreshCw className="w-5 h-5" />, area: "Admin" },
    content: (
      <>
        <p>Todas as sincronizações antigas que rodavam em cron viraram <strong>botões manuais</strong> no painel <em>Sincronizar agora</em> (aba Dados).</p>
        <Callout kind="tip">Rotina recomendada: 1 clique de manhã, 1 clique no fim da tarde. Isso mantém tudo atualizado sem sobrecarga.</Callout>
        <ButtonRow items={[
          { name: "Ads Competitor Scraper", desc: "Analisa anúncios da concorrência. Custa tempo — semanal basta." },
          { name: "AI Daily Digest", desc: "Resumo do dia por e-mail. Rode ao fim do dia." },
          { name: "AI Learn Feedback", desc: "Consolida feedback dos atendimentos para a IA aprender." },
          { name: "Facebook Creative Rotator", desc: "Sugere trocar criativos com fadiga." },
          { name: "FB Sync Audiences", desc: "Atualiza públicos personalizados do Facebook." },
          { name: "Pós-venda Bucket", desc: "Agrupa clientes para campanhas de pós-venda." },
          { name: "Flow Engine Housekeeping", desc: "Faxina de dados do motor de fluxos." },
          { name: "Migrate storage / MinIO quota", desc: "Manutenção de armazenamento." },
          { name: "Cleanup Webhook Artifacts", desc: "Limpa webhooks antigos." },
          { name: "Super Admin Alerts", desc: "Dispara alertas para super admins." },
        ]} />
      </>
    ),
  },

  /* ---------------------- Erros ---------------------- */
  {
    def: { id: "erros", title: "27. Erros comuns e como resolver", icon: <AlertTriangle className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <ButtonRow items={[
          { name: "Login: 504 / CORS", desc: "Servidor Supabase sobrecarregado. Espere 30s. Se persistir, avise suporte." },
          { name: "WhatsApp desconectado", desc: "Vá em Saúde do Bot → Reconectar. Se não voltar, leia QR novo." },
          { name: "Fluxo não dispara", desc: "Confira se está PUBLICADO (não só salvo). Verifique gatilho de entrada." },
          { name: "Sincronização travada", desc: "Recarregue a página. Se persistir, chame super admin." },
          { name: "Notificações não chegam", desc: "Habilite permissão do navegador. No celular, permita notificações do PWA." },
          { name: "'Você não tem permissão'", desc: "Seu perfil não tem role suficiente. Peça upgrade ao licenciado responsável." },
          { name: "Página em branco / bug estranho", desc: "Acesse /reset para limpar cache local." },
        ]} />
      </>
    ),
  },

  /* ---------------------- Seg ---------------------- */
  {
    def: { id: "seguranca", title: "28. Segurança e boas práticas", icon: <Shield className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Senha forte:</strong> mínimo 10 caracteres, com número e símbolo. Troque a cada 6 meses.</li>
          <li><strong>Não compartilhe login:</strong> cada consultor tem o seu. Compartilhar viola LGPD.</li>
          <li><strong>Modo privacidade em reuniões:</strong> sempre ligue o olho antes de compartilhar tela.</li>
          <li><strong>Roles:</strong> só promova alguém a admin quando realmente precisar. Super admin é raríssimo.</li>
          <li><strong>Sair em máquina pública:</strong> sempre clique em "Sair" no menu do avatar.</li>
          <li><strong>Backup:</strong> exporte CSVs importantes uma vez por semana (Dashboard → Exportar).</li>
        </ul>
      </>
    ),
  },

  /* ---------------------- FAQ ---------------------- */
  {
    def: { id: "faq", title: "29. Perguntas frequentes", icon: <HelpCircle className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <ButtonRow items={[
          { name: "Posso usar em vários dispositivos?", desc: "Sim. O mesmo login funciona em celular e computador ao mesmo tempo." },
          { name: "Preciso deixar o computador ligado para o bot funcionar?", desc: "Não. O bot roda na nuvem. Você pode fechar tudo." },
          { name: "Como troco o WhatsApp conectado?", desc: "Peça ao super admin para clicar em Phone Reset. Depois leia o novo QR." },
          { name: "Quanto custa usar IA?", desc: "Depende do volume. Veja o card 'AI Cost' no Dashboard e defina limite em AI Agent." },
          { name: "Perdi um lead — dá para recuperar?", desc: "Sim. Vá em Clientes WhatsApp → filtro 'Arquivados'. Nenhum contato é deletado, só oculto." },
          { name: "Como convido alguém para minha rede?", desc: "Menu Rede → 'Convidar novo'. Copie o link e envie." },
        ]} />
      </>
    ),
  },

  /* ---------------------- Contato ---------------------- */
  {
    def: { id: "contato", title: "30. Contato e suporte", icon: <Rocket className="w-5 h-5" />, area: "Geral" },
    content: (
      <>
        <p>Se ficou dúvida:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Abra o <strong>Assistente IA</strong> (estrela no topo do admin) — resolve 80% dos casos.</li>
          <li>Fale com seu <strong>licenciado responsável</strong> — ele tem canal direto de suporte.</li>
          <li>Emergência técnica (bot fora do ar, ninguém consegue logar): contate o super admin.</li>
        </ul>
        <div className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center">
          <div className="text-emerald-700 font-semibold text-lg">Parabéns! Você terminou o tutorial.</div>
          <p className="text-emerald-800 text-sm mt-1">Volte aqui sempre que precisar. O link é <code>igreen.cloud/tutorial</code>.</p>
        </div>
      </>
    ),
  },
];

/* =========================================================================
 * Page
 * =======================================================================*/

export default function Tutorial() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(sections[0].def.id);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scrollspy
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.def.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => s.def.title.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SEOHead
        title="Tutorial completo — iGreen Cloud"
        description="Guia passo a passo de todas as funções da plataforma iGreen Cloud: site público, área do consultor, admin e super admin. Feito para leigos, com ilustrações."
      />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 text-emerald-700 font-bold shrink-0">
            <BookOpen className="w-5 h-5" />
            <span className="hidden sm:inline">iGreen Tutorial</span>
          </Link>
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar (ex.: sino, fluxo, IA, meta ads...)"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <a
            href="#topo"
            className="hidden md:inline-flex items-center gap-1 text-sm text-slate-600 hover:text-emerald-700"
          >
            <ArrowUp className="w-4 h-4" /> Topo
          </a>
        </div>
      </header>

      {/* Hero */}
      <div id="topo" className="border-b border-slate-200 bg-gradient-to-b from-emerald-50 to-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <span className="inline-block text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
              Guia oficial
            </span>
            <h1 className="mt-3 text-3xl md:text-5xl font-black tracking-tight text-slate-900">
              Tutorial completo da plataforma iGreen Cloud
            </h1>
            <p className="mt-4 text-slate-700 text-base md:text-lg leading-relaxed">
              Tudo sobre cada página, cada botão e cada ícone — do site público até o super admin.
              Escrito para leigos, com ilustrações, passo a passo e dicas de quando usar.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#boas-vindas" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 font-semibold">
                <Play className="w-4 h-4" /> Começar
              </a>
              <a href="#topbar" className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-300 hover:border-emerald-500 px-5 py-2.5 font-semibold text-slate-800">
                <Star className="w-4 h-4 text-emerald-600" /> O que faz o sino, IA e o olho?
              </a>
            </div>
          </div>
          <div>
            <img src={heroImg} alt="Tutorial iGreen Cloud" width={1280} height={720} className="w-full rounded-3xl shadow-lg border border-white" />
          </div>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid md:grid-cols-[260px_1fr] gap-8">
        {/* TOC */}
        <aside className="hidden md:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Índice</div>
            <nav className="space-y-1">
              {filtered.map((s) => {
                const active = s.def.id === activeId;
                return (
                  <a
                    key={s.def.id}
                    href={`#${s.def.id}`}
                    className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-md transition-colors ${
                      active
                        ? "bg-emerald-100 text-emerald-800 font-semibold"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <ChevronRight className={`w-3 h-3 flex-none ${active ? "text-emerald-600" : "text-slate-400"}`} />
                    <span className="truncate">{s.def.title}</span>
                  </a>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-sm text-slate-500 px-2">Nada encontrado para "{query}".</div>
              )}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main ref={contentRef} className="min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm px-5 md:px-10 py-2">
          {sections.map((s) => (
            <Section key={s.def.id} def={s.def}>{s.content}</Section>
          ))}

          <div className="py-10 text-center text-sm text-slate-500">
            Fim do tutorial • <Link to="/admin" className="text-emerald-700 underline">Ir para o Admin</Link>
          </div>
        </main>
      </div>
    </div>
  );
}
