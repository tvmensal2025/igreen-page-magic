const referralItems = [
  { icon: "🔄", text: "Você também participa do nosso Programa de Indicações, chamado de Cashback Sustentável" },
  { icon: "💰", text: "Ao indicar um novo cliente aprovado, você receberá um cashback todos os meses, que será usado para reduzir o valor do seu boleto iGreen Energy" },
  { icon: "📊", text: "Para cada indicação você ganha até 2% de cashback calculado com base no boleto iGreen Energy pago pelo cliente que você indicou" },
  { icon: "💡", text: "Por exemplo, se você indicar um cliente com uma conta de luz de R$ 500, será contabilizado até R$ 10,00 de cashback — abatido automaticamente no seu próximo boleto" },
  { icon: "🚀", text: "Quanto mais clientes você indicar, mais cashback acumulará, aumentando a possibilidade de zerar o valor da sua conta de luz" },
];

const ReferralSection = () => (
  <section>
    <div className="section-container">
      <h2 className="section-heading mb-10">Veja como você pode zerar sua conta de luz através de indicações</h2>

      <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden relative mb-14" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
        <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
        <video controls className="w-full aspect-video relative z-0">
          <source src="https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/cash-back-igreen.mp4" type="video/mp4" />
        </video>
      </div>

      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="relative group">
          <div className="media-glow" />
          <img
            src="/images/cashback-sustentavel.jpeg"
            alt="Cashback Sustentável iGreen Energy"
            loading="lazy"
            decoding="async"
            className="rounded-2xl w-full shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>

        <div className="space-y-5">
          {referralItems.map((item, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl flex items-start gap-3">
              <span className="text-2xl shrink-0">{item.icon}</span>
              <span className="text-foreground/90 leading-relaxed">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default ReferralSection;
