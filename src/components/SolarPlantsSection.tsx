const SolarPlantsSection = () => (
  <section>
    <div className="section-container">
      <div className="badge-green mx-auto mb-6">Infraestrutura</div>
      <h2 className="section-heading mb-6">Nossas usinas solares</h2>

      <div className="max-w-4xl mx-auto">
        <div className="relative group mb-12">
          <div className="media-glow" />
          <img
            src="/images/feed-1.jpeg"
            alt="Usinas Solares iGreen"
            loading="lazy"
            decoding="async"
            className="rounded-2xl w-full shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.01]"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto mb-16">
          <div className="glass-card text-center">
            <div className="text-4xl mb-3">⚡</div>
            <p className="text-foreground/90 leading-relaxed">Mais de <strong className="text-primary">100 usinas</strong> espalhadas pelo Brasil produzindo energia limpa, sustentável e mais barata</p>
          </div>
          <div className="glass-card text-center">
            <div className="text-4xl mb-3">🌱</div>
            <p className="text-foreground/90 leading-relaxed">Reduzindo <strong className="text-primary">toneladas de CO2</strong> no meio ambiente todos os dias</p>
          </div>
        </div>
      </div>

      <div className="text-center">
        <h3 className="section-heading text-2xl md:text-3xl mb-4">Conheça a UFV Hélio Valgas</h3>
        <p className="text-muted-foreground text-lg mb-8">Nossa usina solar em Várzea da Palma MG</p>
        <div className="max-w-3xl mx-auto rounded-2xl overflow-hidden relative" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
          <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
          <video controls className="w-full aspect-video relative z-0">
            <source src="/videos/usina-helio-valgas.mp4" type="video/mp4" />
            Seu navegador não suporta vídeos.
          </video>
        </div>
      </div>
    </div>
  </section>
);

export default SolarPlantsSection;
