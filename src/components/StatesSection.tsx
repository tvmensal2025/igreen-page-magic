const StatesSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ background: 'radial-gradient(circle at 30% 70%, hsl(130, 100%, 36%), transparent 50%)' }} />
    <div className="section-container text-center relative z-10">
      <div className="badge-green mx-auto mb-6">Cobertura</div>
      <h2 className="section-heading mb-4">Atendemos 27 estados do Brasil</h2>
      <p className="text-foreground/70 text-lg max-w-2xl mx-auto mb-12">
        A iGreen Energy está presente em praticamente todo o território nacional, levando economia e sustentabilidade para milhares de brasileiros
      </p>

      <div className="relative group max-w-lg mx-auto mb-10">
        <div className="media-glow !-inset-6" />
        <img
          src="/images/imagem-3.jpeg"
          alt="Mapa do Brasil - Estados atendidos pela iGreen Energy"
          loading="lazy"
          decoding="async"
          className="rounded-2xl w-full shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
          style={{ boxShadow: 'var(--shadow-card)' }}
        />
      </div>

      <p className="font-heading font-bold text-xl" style={{ color: 'hsl(var(--primary))' }}>
        🌍 Em breve estaremos em todo o Brasil
      </p>
    </div>
  </section>
);

export default StatesSection;
