import { trackClickEvent } from "@/hooks/useTrackEvent";
import AnimatedCounter from "@/components/common/AnimatedCounter";
import AmbientGlow from "@/components/common/AmbientGlow";
import LandingNav from "@/components/common/LandingNav";
import { ArrowRight } from "lucide-react";

interface HeroSectionProps {
  cadastroUrl?: string;
  whatsappUrl?: string;
  consultantId?: string;
}

const DEFAULT_CADASTRO_URL = "https://digital.igreenenergy.com.br/?sendcontract=true";
const DEFAULT_WHATSAPP_URL = "https://wa.me/5500000000000?text=Ol%C3%A1,%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20o%20desconto%20na%20conta%20de%20luz%20oferecido%20pela%20iGreen%20Energy";

const HeroSection = ({ cadastroUrl, whatsappUrl, consultantId }: HeroSectionProps) => {
  const CADASTRO = cadastroUrl || DEFAULT_CADASTRO_URL;
  const WHATSAPP = whatsappUrl || DEFAULT_WHATSAPP_URL;

  const handleClick = (target: string) => {
    if (consultantId) trackClickEvent(consultantId, target, "client");
  };

  return (
    <section id="top" className="relative overflow-hidden pt-28 md:pt-36 pb-16 md:pb-24" style={{ background: 'var(--gradient-hero)' }}>
      <LandingNav
        ctaLabel="Falar no WhatsApp"
        ctaHref={WHATSAPP}
        onCtaClick={() => handleClick("whatsapp")}
      />
      {/* Decorative background */}
      <AmbientGlow variant="hero" />
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-10">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="badge-green animate-fade-in mb-6">
            <span className="glow-dot" />
            <span>Economia garantida</span>
          </div>

          {/* Title */}
          <h1 className="font-heading font-black tracking-[-0.03em] leading-[1.05] text-[2.2rem] sm:text-5xl md:text-6xl lg:text-[4rem] max-w-[18ch] mx-auto text-foreground">
            Receba até <span className="text-gradient-green">20% de desconto</span> na sua conta de luz todo mês
          </h1>

          {/* Subtitle */}
          <p className="mt-6 text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Energia solar por assinatura, sem instalar placas, sem obras e sem custos. Conheça a oportunidade da iGreen Energy para sua casa, comércio ou empresa.
          </p>

          {/* CTA buttons */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center w-full sm:w-auto">
            <a href={CADASTRO} target="_blank" rel="noopener noreferrer" className="btn-cta-lg animate-pulse-green" onClick={() => handleClick("cadastro")}>
              Faça seu cadastro <ArrowRight className="w-5 h-5" />
            </a>
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-whatsapp" onClick={() => handleClick("whatsapp")}>
              💬 Atendimento no WhatsApp
            </a>
          </div>
        </div>

        {/* Video mockup */}
        <div className="relative mt-14 md:mt-20 max-w-4xl mx-auto">
          <div className="mockup-window">
            <div className="mockup-bar">
              <span className="mockup-dot bg-red-400/70" />
              <span className="mockup-dot bg-yellow-400/70" />
              <span className="mockup-dot bg-green-400/70" />
              <div className="ml-3 h-5 flex-1 max-w-xs rounded-md bg-muted/60" />
            </div>
            <video controls playsInline autoPlay muted className="w-full aspect-video block" poster="">
              <source src="/videos/Green_Energy.mp4" type="video/mp4" />
              Seu navegador não suporta vídeos.
            </video>
          </div>
        </div>

        {/* Social proof */}
        <div className="grid grid-cols-3 gap-2 sm:gap-6 md:gap-12 max-w-3xl mx-auto mt-16 md:mt-20 pt-10 border-t border-border px-2">
          <div className="text-center">
            <AnimatedCounter target={600} suffix="mil+" />
            <p className="text-[11px] sm:text-xs md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Clientes<br className="sm:hidden" /> ativos</p>
          </div>
          <div className="text-center">
            <AnimatedCounter target={500} suffix="+" />
            <p className="text-[11px] sm:text-xs md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Usinas<br className="sm:hidden" /> solares</p>
          </div>
          <div className="text-center">
            <AnimatedCounter target={27} />
            <p className="text-[11px] sm:text-xs md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading leading-tight">Estados</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
