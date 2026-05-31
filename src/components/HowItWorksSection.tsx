const steps = [
  { icon: "💡", text: "Nossas usinas produzem energia solar, a energia é injetada na rede da distribuidora, a distribuidora envia a energia para sua casa ou empresa, você economiza de forma gratuita sem investimentos" },
  { icon: "💡", text: "Como a nossa energia solar é mais barata do que a energia hidrelétrica normalmente utilizada pelas distribuidoras, nós conseguimos oferecer um desconto de até 20% por mês para nossos clientes" },
  { icon: "💡", text: "Você não paga nenhum centavo para ter acesso a esses descontos, não precisa instalar placas solares, não alteramos sua instalação de energia, não tem obras, não tem taxa de adesão, não tem mensalidade, não tem fidelidade. Todo o cadastro é 100% online e gratuito" },
  { icon: "💡", text: "Nós atendemos casas, apartamentos, prédios, condomínios, fazendas, comércios e empresas" },
  { icon: "💡", text: "Nosso trabalho está regulamentado pela Lei Federal 14.300 de 6 de Janeiro de 2022. Os consumidores já podem escolher o tipo de energia que desejam utilizar em suas residências e empresas, se é a energia hidrelétrica ou a energia solar renovável e mais barata" },
];

import LazyVideo from "@/components/ui/LazyVideo";

const HowItWorksSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ background: 'radial-gradient(circle at 80% 50%, hsl(130, 100%, 36%), transparent 60%)' }} />
    <div className="section-container relative z-10">
      <div className="badge-green mx-auto mb-6">Entenda</div>
      <h2 className="section-heading mb-10">Como funciona a energia solar da iGreen Energy</h2>

      <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden relative mb-14" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
        <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
        <LazyVideo src="https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/casasustentavel.mp4" />
      </div>

      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="relative group">
          <div className="media-glow" />
          <img
            src="/images/foto-12-como-funciona.jpeg"
            alt="Como a energia solar chega na sua casa ou empresa"
            loading="lazy"
            className="rounded-2xl w-full shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>

        <div className="space-y-5">
          {steps.map((step, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl flex items-start gap-3">
              <span className="text-2xl shrink-0">{step.icon}</span>
              <span className="text-foreground/90 leading-relaxed">{step.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
