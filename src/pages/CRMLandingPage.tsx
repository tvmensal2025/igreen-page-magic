import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { captureLeadSource } from "@/lib/fbclid";
import { Volume2 } from "lucide-react";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import AnimatedCounter from "@/components/common/AnimatedCounter";
import AmbientGlow from "@/components/common/AmbientGlow";
import LandingNav from "@/components/common/LandingNav";
import BrandLogo from "@/components/common/BrandLogo";
import { useCrmPageView, trackCrmClick } from "@/hooks/useCrmTracking";
import {
  MessageSquare,
  LayoutDashboard,
  Users,
  Clock,
  Send,
  BarChart3,
  Zap,
  Shield,
  Headphones,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const WHATSAPP_CTA = "https://wa.me/5511989000650?text=Ol%C3%A1,%20quero%20conhecer%20o%20CRM%20iGreen";

const NAV_ITEMS = [
  { label: "Funcionalidades", href: "#section-funcionalidades" },
  { label: "Como funciona", href: "#section-como-funciona" },
  { label: "Diferenciais", href: "#section-diferenciais" },
];

/* ── Feature data ── */
const features = [
  {
    icon: MessageSquare,
    title: "WhatsApp Integrado",
    desc: "Envie e receba mensagens direto do CRM, com modelos prontos, respostas rápidas e gravação de áudio. Tudo em uma única tela. ",
  },
  {
    icon: LayoutDashboard,
    title: "Funil de Vendas",
    desc: "Quadro visual onde você arrasta cada cliente entre as etapas, do primeiro contato até o pagamento do boleto da iGreen.",
  },
  {
    icon: Users,
    title: "Gestão de Clientes",
    desc: "Sincronizado com seus clientes da igreen.\n\nCadastro completo, importação em massa via planilha, histórico de conversas e organização por categorias.",
  },
  {
    icon: Clock,
    title: "Mensagens Agendadas",
    desc: "Programe retornos automáticos e sequências de mensagens para nunca perder o momento certo. Eu uso muito para o cliente que tem empréstimo: agendo uma mensagem automática.",
  },
  {
    icon: Send,
    title: "Mensagens em Massa",
    desc: "Envio em lote com modelos personalizados, incluindo imagens e áudios para toda a sua base de contatos.",
  },
  {
    icon: BarChart3,
    title: "Painel de Métricas",
    desc: "Gráficos de performance, taxa de resposta, conversão por etapa e ranking de consultores em tempo real.",
  },
];

const steps = [
  { num: "01", title: "Crie sua conta", desc: "Cadastro rápido e seguro em menos de 2 minutos." },
  { num: "02", title: "Conecte seu WhatsApp", desc: "Escaneie o QR Code e comece a atender pelo CRM." },
  { num: "03", title: "Comece a vender", desc: "Gerencie clientes, automatize mensagens e acompanhe resultados." },
];

const differentials = [
  { icon: Zap, title: "Integração Nativa", desc: "Conecta direto com a plataforma iGreen Energy sem configurações extras." },
  { icon: Shield, title: "Sem Custo Extra", desc: "Incluído no seu plano de licenciado. Sem mensalidades adicionais." },
  { icon: Headphones, title: "Suporte Dedicado", desc: "Equipe pronta para te ajudar a tirar o máximo do CRM." },
];

interface AudioTemplate {
  id: string;
  name: string;
  media_url: string;
}

/* ── Secure Audio Player ── */
const SecureAudioPlayer = ({ url }: { url: string }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    if (!audioRef.current) {
      const a = new Audio();
      a.crossOrigin = "anonymous";
      a.preload = "metadata";
      a.src = url;
      a.addEventListener("timeupdate", () => {
        setCurrent(a.currentTime);
        setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
      });
      a.addEventListener("loadedmetadata", () => setDuration(a.duration));
      a.addEventListener("ended", () => { setPlaying(false); setProgress(0); setCurrent(0); });
      audioRef.current = a;
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
      trackCrmClick("audio_play");
    }
  };

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
  };

  return (
    <div className="flex items-center gap-3 select-none min-w-0 w-full" onContextMenu={(e) => e.preventDefault()}>
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 transition-colors shrink-0"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9-5.5z" /></svg>
        )}
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="h-2 rounded-full bg-secondary cursor-pointer" onClick={seek}>
          <div className="h-full rounded-full bg-primary transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>{fmt(currentTime)}</span>
          <span>{duration ? fmt(duration) : "0:00"}</span>
        </div>
      </div>
    </div>
  );
};
const CRMLandingPage = () => {
  const [audioTemplates, setAudioTemplates] = useState<AudioTemplate[]>([]);
  const trackedSections = useRef(new Set<string>());

  // Track page view
  useCrmPageView();
  useEffect(() => { captureLeadSource(); }, []);

  // Track scroll depth & section visibility
  useEffect(() => {
    const sections = ["funcionalidades", "templates", "como-funciona", "diferenciais", "cta-final"];
    const observers: IntersectionObserver[] = [];

    sections.forEach((id) => {
      const el = document.getElementById(`section-${id}`);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !trackedSections.current.has(id)) {
            trackedSections.current.add(id);
            trackCrmClick(`scroll_${id}`);
          }
        },
        { threshold: 0.3 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    supabase
      .from("message_templates")
      .select("id, name, media_url")
      .eq("media_type", "audio")
      .not("media_url", "is", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setAudioTemplates(data as AudioTemplate[]);
      });
  }, []);

  return (
    <div id="top" className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <LandingNav
        items={NAV_ITEMS}
        ctaLabel="Falar no WhatsApp"
        ctaHref={WHATSAPP_CTA}
        onCtaClick={() => trackCrmClick("nav_cta")}
      />

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden pt-28 md:pt-36 pb-16 md:pb-24" style={{ background: "var(--gradient-hero)" }}>
        <AmbientGlow variant="hero" />
        <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden />

        <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 sm:px-8 lg:px-10">
          {/* Coluna de texto centralizada + mockup grande abaixo (estilo Linear/Vercel) */}
          <div className="flex flex-col items-center text-center min-w-0">
            <div className="badge-green animate-fade-in mb-6">
              <span className="glow-dot" />
              <span>CRM iGreen Energy</span>
            </div>

            <h1 className="font-heading font-black tracking-[-0.03em] leading-[1.05] text-[2rem] sm:text-5xl md:text-6xl lg:text-[4.25rem] max-w-[16ch] mx-auto break-words">
              Venda mais com o CRM que <span className="text-gradient-green">trabalha por você</span>
            </h1>

            <p className="mt-6 text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              WhatsApp integrado, funil de vendas, mensagens automáticas e painel de métricas — tudo em um só lugar, sem custo extra para o licenciado iGreen.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center w-full max-w-md sm:max-w-none mx-auto">
              <a href={WHATSAPP_CTA} target="_blank" rel="noopener noreferrer" className="btn-cta-lg animate-pulse-green w-full sm:w-auto justify-center" onClick={() => trackCrmClick("hero_cta")}>
                Quero conhecer o CRM <ArrowRight className="w-5 h-5 shrink-0" />
              </a>
              <a href="#section-funcionalidades" className="btn-whatsapp w-full sm:w-auto justify-center">
                Ver funcionalidades
              </a>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-primary" /> Sem cartão de crédito</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-primary" /> Pronto em minutos</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-primary" /> Suporte incluso</span>
            </div>
          </div>

          {/* Mockup grande do produto (vídeo dentro de janela de navegador) */}
          <div className="relative mt-14 md:mt-20 max-w-5xl mx-auto w-full min-w-0 px-0">
            {/* chips flutuantes de prova social */}
            <div className="floating-chip -left-4 top-8 hidden lg:flex animate-float">
              <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center"><MessageSquare size={18} /></div>
              <div className="text-left min-w-0">
                <p className="text-xs text-muted-foreground leading-none">Conversas hoje</p>
                <p className="text-sm font-bold text-foreground">+128</p>
              </div>
            </div>
            <div className="floating-chip -right-4 bottom-16 hidden lg:flex animate-float" style={{ animationDelay: "1.2s" }}>
              <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center"><BarChart3 size={18} /></div>
              <div className="text-left min-w-0">
                <p className="text-xs text-muted-foreground leading-none">Conversão</p>
                <p className="text-sm font-bold text-foreground">+32%</p>
              </div>
            </div>

            <div className="mockup-window max-w-full overflow-hidden">
              <div className="mockup-bar min-w-0">
                <span className="mockup-dot bg-destructive/70" />
                <span className="mockup-dot bg-warning/70" />
                <span className="mockup-dot bg-primary/70" />
                <div className="ml-3 h-5 flex-1 max-w-xs min-w-0 rounded-md bg-muted/60" />
              </div>
              <video
                controls
                playsInline
                className="w-full max-w-full aspect-video block"
                poster=""
                onPlay={() => trackCrmClick("video_play")}
                onPause={() => trackCrmClick("video_pause")}
                onEnded={() => trackCrmClick("video_completed")}
              >
                <source src="https://igreen-minio.d9v63q.easypanel.host/igreen/Video%20para%20venda%20do%20crm.mp4" type="video/mp4" />
                Seu navegador não suporta vídeos.
              </video>
            </div>
          </div>

          {/* Stats em faixa */}
          <div className="grid grid-cols-3 gap-2 sm:gap-8 max-w-3xl mx-auto mt-16 md:mt-20 pt-10 border-t border-border px-1">
            <div className="text-center min-w-0">
              <AnimatedCounter target={6} suffix="+" />
              <p className="text-[10px] sm:text-xs mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Módulos<br className="sm:hidden" /> integrados</p>
            </div>
            <div className="text-center min-w-0">
              <AnimatedCounter target={100} suffix="%" />
              <p className="text-[10px] sm:text-xs mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Automatizado</p>
            </div>
            <div className="text-center min-w-0">
              <AnimatedCounter target={24} suffix="/7" />
              <p className="text-[10px] sm:text-xs mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Disponível</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FUNCIONALIDADES ═══ */}
      <section id="section-funcionalidades" className="section-gradient">
        <div className="section-container-wide">
          <div className="text-center mb-12 md:mb-16">
            <div className="section-eyebrow mb-4">
              <span className="glow-dot" />
              Funcionalidades
            </div>
            <h2 className="section-heading">
              Tudo que você precisa para <span className="text-gradient-green">vender mais</span>
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto text-base md:text-lg">
              Cada módulo foi pensado para simplificar sua rotina e aumentar suas conversões.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {features.map((f) => (
              <div key={f.title} className="feature-card group cursor-default">
                <div className="feature-icon">
                  <f.icon size={24} />
                </div>
                <h3 className="font-heading font-bold text-lg text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TEMPLATES DE ÁUDIO ═══ */}
      {audioTemplates.length > 0 && (
        <section id="section-templates">
          <div className="section-container">
            <div className="text-center mb-12 md:mb-16">
              <div className="section-eyebrow mb-4">
                <span className="glow-dot" />
                Modelos prontos
              </div>
              <h2 className="section-heading">
                Áudios profissionais <span className="text-gradient-green">inclusos</span>
              </h2>
              <p className="text-muted-foreground mt-4 max-w-2xl mx-auto text-base md:text-lg">
                Utilize modelos de áudio prontos para cada etapa do funil. Envie com um clique direto pelo CRM.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {audioTemplates.map((t) => (
                <div key={t.id} className="glass-card flex flex-col gap-3" onContextMenu={(e) => e.preventDefault()}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/15 text-primary shrink-0">
                      <Volume2 size={20} />
                    </div>
                    <h3 className="font-heading font-bold text-sm text-foreground truncate">{t.name}</h3>
                  </div>
                  <SecureAudioPlayer url={t.media_url} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ COMO FUNCIONA ═══ */}
      <section id="section-como-funciona">
        <div className="section-container">
          <div className="text-center mb-12 md:mb-16">
            <div className="section-eyebrow mb-4 justify-center">
              <span className="glow-dot" />
              Como funciona
            </div>
            <h2 className="section-heading">
              Comece em <span className="text-gradient-green">3 passos</span> simples
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5 md:gap-6 max-w-5xl mx-auto">
            {steps.map((s) => (
              <div key={s.num} className="feature-card group">
                <div className="flex items-center gap-4 mb-4">
                  <span className="font-heading font-black text-5xl leading-none text-gradient-green">{s.num}</span>
                  <div className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
                </div>
                <h3 className="font-heading font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ DIFERENCIAIS ═══ */}
      <section id="section-diferenciais" className="section-gradient">
        <div className="section-container">
          <div className="text-center mb-12 md:mb-16">
            <div className="section-eyebrow mb-4">
              <span className="glow-dot" />
              Diferenciais
            </div>
            <h2 className="section-heading">
              Por que escolher o <span className="text-gradient-green">CRM iGreen?</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {differentials.map((d) => (
              <div key={d.title} className="feature-card text-center group">
                <div className="feature-icon mx-auto !w-14 !h-14 !rounded-2xl">
                  <d.icon size={28} />
                </div>
                <h3 className="font-heading font-bold text-lg mb-2">{d.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{d.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA FINAL ═══ */}
      <section id="section-cta-final" className="cta-band relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-dots pointer-events-none" aria-hidden />
        <div className="section-container text-center relative z-10 public-page-safe-bottom">
          <h2 className="section-heading mb-4">
            Pronto para <span className="text-gradient-green">transformar suas vendas?</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-8 text-lg">
            Junte-se aos consultores que já estão fechando mais negócios com o CRM iGreen Energy.
          </p>
          <a href={WHATSAPP_CTA} target="_blank" rel="noopener noreferrer" className="btn-cta-lg animate-pulse-green w-full sm:w-auto max-w-md mx-auto justify-center" onClick={() => trackCrmClick("footer_cta")}>
            Quero contratar o CRM <ArrowRight className="w-5 h-5 shrink-0" />
          </a>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 mt-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-primary" /> Sem cartão de crédito</span>
            <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-primary" /> Pronto em minutos</span>
            <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-primary" /> Suporte incluso</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/40 public-page-safe-bottom">
        <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-8 lg:px-10 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 min-w-0">
            <div className="flex flex-col items-center md:items-start gap-3 min-w-0">
              <BrandLogo className="w-28 max-w-full h-auto" />
              <p className="text-sm text-muted-foreground max-w-xs text-center md:text-left">
                CRM completo para licenciados iGreen Energy venderem mais.
              </p>
            </div>
            <a href={WHATSAPP_CTA} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full sm:w-auto justify-center max-w-xs" onClick={() => trackCrmClick("footer_whatsapp")}>
              Falar com a equipe
            </a>
          </div>
          <div className="hr-glow my-8" />
          <p className="text-center text-xs text-muted-foreground px-2">
            © {new Date().getFullYear()} iGreen Energy — Todos os direitos reservados.
          </p>
        </div>
      </footer>

      <WhatsAppFloat url={WHATSAPP_CTA} onClickTrack={() => trackCrmClick("whatsapp_float")} />
    </div>
  );
};

export default CRMLandingPage;
