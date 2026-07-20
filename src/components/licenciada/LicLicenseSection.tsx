const licenseItems = [
  "Receba um Kit com crachá, folders iGreen Energy e iGreen Telecom, adesivos de casa / empresa / condomínio sustentável, chips físicos e digitais",
  "Acesso ao aplicativo iGreen com todas as funções disponíveis para conexões, acompanhamento de status e muito mais",
  "Suporte personalizado para Licenciados e Clientes",
  "Material de apoio impresso e digital",
  "Treinamentos online do iGreen Academy",
  "Benefícios exclusivos do iGreen Club com descontos em mais de 30 mil estabelecimentos em todo o Brasil",
  "Amigo do meio ambiente, contribuindo para um mundo mais sustentável",
];

const LicLicenseSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{ background: 'radial-gradient(circle at 50% 0%, hsl(130, 100%, 36%), transparent 60%)' }} />
    <div className="section-container relative z-10">
      <div className="badge-green mx-auto mb-6">Licença</div>
      <h2 className="section-heading mb-4">Licença iGreen Energy</h2>
      <p className="text-center text-foreground/70 text-xl font-heading font-bold mb-14">
        Seja nosso licenciado e mude sua realidade financeira
      </p>
      <div className="max-w-5xl mx-auto grid md:grid-cols-[320px_1fr] gap-10 items-start">
        <img src="/images/kit-licenciado-igreen.png" alt="Kit Licença iGreen Energy" loading="lazy" className="rounded-2xl w-full max-w-full h-auto shadow-lg transition-transform duration-500 hover:scale-[1.02] md:sticky md:top-8" style={{ boxShadow: 'var(--shadow-green-lg)' }} />
        <div className="space-y-3">
          {licenseItems.map((item, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl flex items-start gap-3">
              <span className="text-lg mt-0.5 shrink-0">✅</span>
              <span className="text-foreground/90 text-base leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default LicLicenseSection;
