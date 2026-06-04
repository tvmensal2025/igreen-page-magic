import { trackClickEvent } from "@/hooks/useTrackEvent";
import AnimatedCounter from "@/components/common/AnimatedCounter";
import AmbientGlow from "@/components/common/AmbientGlow";
import LandingNav from "@/components/common/LandingNav";
import { ArrowRight } from "lucide-react";

interface LicHeroSectionProps {
  cadastroUrl?: string;
  whatsappUrl?: string;
  consultantId?: string;
}

const DEFAULT_CADASTRO = "https://digital.igreenenergy.com.br/?sendcontract=true";
const DEFAULT_WHATSAPP = "https://wa.me/5500000000000?text=Ol%C3%A1,%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20oportunidade%20de%20Licenciado%20iGreen%20Energy";

const LicHeroSection = ({ cadastroUrl, whatsappUrl, consultantId }: LicHeroSectionProps) => {
  const CADASTRO = cadastroUrl || DEFAULT_CADASTRO;
  const WHATSAPP = whatsappUrl || DEFAULT_WHATSAPP;

  const handleClick = (target: string) => {
    if (consultantId) trackClickEvent(consultantId, target, "licenciada");
  };

  return (
    <section id="top" className="relative overflow-hidden pt-20 md:pt-36 pb-12 md:pb-24" style={{ background: 'var(--gradient-hero)' }}>
      <LandingNav
        ctaLabel="Quero ser Licenciado"
        ctaLabelMobile="Licenciado"
        ctaHref={WHATSAPP}
        onCtaClick={() => handleClick("whatsapp")}
      />
      {/* Decorative background elements */}
      <AmbientGlow variant="hero" />
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 sm:px-8 lg:px-10">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="badge-green animate-fade-in mb-6">
            <span className="glow-dot" />
            <span>Oportunidade exclusiva</span>
          </div>

          {/* Title */}
          <h1 className="font-heading font-black tracking-[-0.03em] leading-[1.1] text-[1.65rem] sm:text-4xl md:text-5xl lg:text-[3.9rem] max-w-[20ch] mx-auto text-foreground">
            Seja Licenciado iGreen e receba <span className="text-gradient-green">comissões vitalícias</span> todo mês
          </h1>

          {/* Subtitle */}
          <p className="mt-4 sm:mt-6 text-sm sm:text-base md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            O mercado de energia solar está explodindo no Brasil. Quem está aproveitando agora já está faturando — <strong className="text-foreground">esse é o seu momento.</strong>
          </p>

          {/* CTA */}
          <div className="mt-6 sm:mt-8 grid grid-cols-2 sm:flex sm:flex-row gap-2 sm:gap-3 justify-center items-stretch sm:items-center w-full sm:w-auto max-w-md">
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-cta-lg !px-3 !py-3 !text-xs sm:!px-8 sm:!py-4 sm:!text-lg animate-pulse-green" onClick={() => handleClick("whatsapp")}>
              Ser Licenciado <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </a>
            <a href={CADASTRO} target="_blank" rel="noopener noreferrer" className="btn-whatsapp !px-3 !py-3 !text-xs sm:!px-7 sm:!py-3.5 sm:!text-base" onClick={() => handleClick("cadastro")}>
              Cadastro
            </a>
          </div>
        </div>

        {/* Video mockup */}
        <div className="relative mt-10 md:mt-20 max-w-4xl mx-auto">
          <div className="mockup-window">
            <div className="mockup-bar">
              <span className="mockup-dot bg-red-400/70" />
              <span className="mockup-dot bg-yellow-400/70" />
              <span className="mockup-dot bg-green-400/70" />
              <div className="ml-3 h-5 flex-1 max-w-xs rounded-md bg-muted/60" />
            </div>
            <video playsInline autoPlay muted loop preload="metadata" className="w-full aspect-video block">
              <source src="https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/imagine-licenciado.mp4" type="video/mp4" />
            </video>
          </div>
        </div>

        {/* Social proof stats */}
        <div className="grid grid-cols-3 gap-4 md:gap-12 max-w-3xl mx-auto mt-16 md:mt-20 pt-10 border-t border-border">
          <div className="text-center">
            <AnimatedCounter target={600} suffix="mil+" />
            <p className="text-[10px] md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading">Clientes ativos</p>
          </div>
          <div className="text-center">
            <AnimatedCounter target={500} suffix="+" />
            <p className="text-[10px] md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading">Usinas solares</p>
          </div>
          <div className="text-center">
            <AnimatedCounter target={27} />
            <p className="text-[10px] md:text-sm mt-2 text-muted-foreground uppercase tracking-wider font-heading">Estados</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LicHeroSection;
