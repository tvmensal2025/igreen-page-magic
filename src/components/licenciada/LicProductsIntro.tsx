const products = [
  { num: 1, name: "Conexão Green", desc: "Energia solar por assinatura" },
  { num: 2, name: "Conexão Livre", desc: "Mercado livre de energia" },
  { num: 3, name: "Conexão Solar", desc: "Instalação de placas solares" },
  { num: 4, name: "Conexão Placas", desc: "Compra de placas solares" },
  { num: 5, name: "Conexão Club", desc: "Clube de benefícios individual" },
  { num: 6, name: "Conexão Club PJ", desc: "Clube de benefícios empresarial" },
  { num: 7, name: "Conexão Expansão", desc: "Formação de equipe" },
  { num: 8, name: "Conexão Telecom", desc: "Telefonia e internet" },
  { num: 9, name: "Conexão Seguros", desc: "Proteção veicular acessível" },
];

const LicProductsIntro = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{ background: 'radial-gradient(circle at 20% 80%, hsl(130, 100%, 36%), transparent 50%)' }} />
    <div className="section-container text-center relative z-10">
      <div className="badge-green mx-auto mb-6">Produtos</div>
      <h2 className="section-heading mb-6">Conheça nossos 9 produtos</h2>
      <p className="text-foreground/70 text-lg max-w-3xl mx-auto mb-14">
        Entenda como você será remunerado com cada um deles e construa sua renda recorrente
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {products.map((p) => (
          <div key={p.num} className="glass-card !p-4 text-center group">
            <div className="product-number mx-auto mb-3">{p.num}</div>
            <h3 className="font-heading font-bold text-sm text-foreground mb-1">{p.name}</h3>
            <p className="text-muted-foreground text-xs">{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default LicProductsIntro;
