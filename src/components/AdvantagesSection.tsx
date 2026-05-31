import phoneApp from "@/assets/phone-app.jpg";

const advantages = [
  { icon: "💰", text: "Economia de até 20% todos os meses na sua conta de luz" },
  { icon: "🔄", text: "Cashback Sustentável de até 2% por indicação, podendo zerar sua conta" },
  { icon: "🛒", text: "Descontos exclusivos em mais de 60 mil lojas em todo o Brasil" },
  { icon: "🎁", text: "Benefícios gratuitos — sem custos adicionais" },
  { icon: "📋", text: "Sem burocracia e sem riscos" },
  { icon: "🔓", text: "Sem fidelidade — cancele quando quiser" },
  { icon: "🚫", text: "Sem necessidade de comprar placas solares" },
  { icon: "📱", text: "100% digital — cadastro rápido e online" },
  { icon: "🏆", text: "Certificação RA1000 — excelência em atendimento" },
];

const AdvantagesSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{ background: 'radial-gradient(circle at 20% 40%, hsl(130, 100%, 36%), transparent 50%)' }} />
    <div className="section-container relative z-10">
      <div className="badge-green mx-auto mb-6">Vantagens</div>
      <h2 className="section-heading mb-14">Vantagens de ser iGreen Energy</h2>

      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="relative group">
          <div className="media-glow" />
          <img
            src={phoneApp}
            alt="App iGreen Energy"
            loading="lazy"
            decoding="async"
            className="rounded-2xl w-full max-w-sm mx-auto relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </div>

        <div className="grid gap-3">
          {advantages.map((adv, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl flex items-center gap-3">
              <span className="text-xl shrink-0">{adv.icon}</span>
              <span className="text-foreground/90 text-lg">{adv.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default AdvantagesSection;
