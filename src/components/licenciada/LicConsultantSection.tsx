import consultantDefault from "@/assets/consultant.jpg";

interface LicConsultantSectionProps {
  name?: string;
  whatsappUrl?: string;
  photoUrl?: string | null;
  igreenId?: string | null;
}

const DEFAULT_WHATSAPP = "https://wa.me/5500000000000?text=Ol%C3%A1,%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20oportunidade%20de%20Licenciado%20iGreen%20Energy";

const LicConsultantSection = ({
  name = "Seu Consultor",
  whatsappUrl,
  photoUrl,
  igreenId = "",
}: LicConsultantSectionProps) => {
  const WHATSAPP = whatsappUrl || DEFAULT_WHATSAPP;
  const photo = photoUrl || consultantDefault;
  const displayId = igreenId || "";

  return (
    <section className="relative overflow-hidden">
      <div className="green-divider-glow" />

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(circle, hsl(130, 100%, 36%), transparent 70%)' }} />
      </div>

      <div className="section-container relative z-10">
        <div className="badge-green mx-auto mb-6">Seu consultor</div>
        <h2 className="section-heading mb-2">Licenciado e Líder de Expansão iGreen Energy</h2>
        <p className="text-center font-heading font-bold text-lg mb-12" style={{ color: 'hsl(var(--primary))' }}>ID {displayId}</p>

        <div className="grid md:grid-cols-2 gap-12 items-center max-w-4xl mx-auto">
          <div className="relative group">
            <div className="media-glow" />
            <img
              src={photo}
              alt={`${name} - Licenciado iGreen Energy`}
              loading="lazy"
              className="rounded-2xl w-full max-w-sm mx-auto shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
              style={{ boxShadow: 'var(--shadow-green)' }}
            />
          </div>
          <div>
            <h3 className="font-heading font-bold text-2xl mb-6 text-foreground">{name}</h3>
            <div className="space-y-4 mb-10">
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90">Estou muito feliz com seu interesse em conhecer melhor a iGreen Energy e será um grande prazer tê-lo(a) conosco</span>
              </div>
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90">Estou à disposição para tirar todas as suas dúvidas e fornecer o melhor suporte. Pode contar comigo!</span>
              </div>
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90">Envie uma mensagem para meu WhatsApp clicando no botão abaixo e comece hoje mesmo a faturar com todos os 8 produtos</span>
              </div>
            </div>
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-cta-lg text-center w-full block animate-pulse-green">
              🚀 Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>

      <footer className="bg-card/50 py-10 text-center mt-16 border-t border-border">
        <img src="/images/logo-colorida-igreen.png" alt="iGreen Energy" loading="lazy" className="mx-auto mb-4 w-36" />
        <p className="text-muted-foreground font-heading text-sm tracking-wider">
          {name.toUpperCase()} | LICENCIADO E LÍDER DE EXPANSÃO IGREEN ENERGY ID {displayId}
        </p>
      </footer>
    </section>
  );
};

export default LicConsultantSection;
