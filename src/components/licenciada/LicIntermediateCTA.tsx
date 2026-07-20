import { trackClickEvent } from "@/hooks/useTrackEvent";

interface LicIntermediateCTAProps {
  whatsappUrl: string;
  consultantId?: string;
  headline: string;
  subtext: string;
  emoji?: string;
}

const LicIntermediateCTA = ({ whatsappUrl, consultantId, headline, subtext, emoji = "🚀" }: LicIntermediateCTAProps) => {
  const handleClick = () => {
    if (consultantId) trackClickEvent(consultantId, "whatsapp_intermediate", "licenciada");
  };

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, transparent, hsl(var(--primary) / 0.05), transparent)' }} />
      <div className="section-container !py-12 text-center relative z-10">
        <div className="glass-card !p-5 sm:!p-8 md:!p-12 max-w-3xl mx-auto relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, hsl(var(--primary)), transparent)' }} />
          
          <p className="text-4xl mb-4">{emoji}</p>
          <h3 className="font-heading font-black text-xl md:text-2xl text-foreground mb-3 leading-tight">{headline}</h3>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">{subtext}</p>
          
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-cta-lg animate-pulse-green inline-flex w-full sm:w-auto max-w-full justify-center !px-4 sm:!px-8 text-center"
            onClick={handleClick}
          >
            🚀 Quero garantir minha vaga agora
          </a>
          
          <p className="text-xs text-muted-foreground mt-4 flex items-center justify-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-destructive/100 animate-pulse" />
            Apenas algumas vagas disponíveis na sua região
          </p>
        </div>
      </div>
    </section>
  );
};

export default LicIntermediateCTA;
