const aboutItems = [
  "A maior empresa de energia solar por assinatura do Brasil, com mais de 170 mil clientes ativos que economizam na sua conta de luz todos os meses de forma gratuita",
  "Uma empresa Mineira da cidade de Uberlândia, fundada em 2021, com o propósito de conscientizar as pessoas e empresas da importância de um futuro melhor através de práticas sustentáveis",
  "A nossa missão é facilitar o acesso à energia sustentável, com soluções sem investimento inicial e de rápida adesão",
  "Certificada com o selo RA1000 do Reclame Aqui, o mais alto nível de excelência em atendimento ao cliente",
  "Faça parte deste propósito — muito mais que economia, você contribuindo para um mundo melhor",
];

const AboutSection = () => (
  <section className="relative">
    <div className="green-divider-glow" />
    <div className="section-container">
      <div className="badge-green mx-auto mb-6">Quem somos</div>
      <h2 className="section-heading mb-14">Somos a iGreen Energy</h2>
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="relative group">
          <div className="media-glow" />
          <img
            src="/images/feed-10.jpeg"
            alt="Usina Solar iGreen Energy"
            loading="lazy"
            decoding="async"
            className="rounded-2xl w-full shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>
        <div className="space-y-5">
          {aboutItems.map((item, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl flex items-start gap-3">
              <span className="text-lg mt-0.5 shrink-0">✅</span>
              <span className="text-foreground/90 leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default AboutSection;
