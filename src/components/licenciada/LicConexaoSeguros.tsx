import CommissionBlock from "./CommissionBlock";
import CareerTable from "./CareerTable";

const aboutItems = [
  "🚗 Planos de proteção veicular a partir de valores acessíveis",
  "🛡️ Cobertura contra roubo, furto e colisão conforme o plano",
  "🚑 Assistência 24h em todo o território nacional",
  "📱 Gestão da apólice 100% digital",
  "💰 Preços competitivos frente a seguradoras tradicionais",
  "🔧 Rede credenciada com milhares de oficinas parceiras",
];

const LicConexaoSeguros = () => (
  <section className="section-gradient">
    <div className="section-container">
      <div className="text-center mb-12">
        <div className="product-number mx-auto mb-4">9</div>
        <h2 className="section-heading mb-4">Conexão Seguros</h2>
        <p className="text-foreground/70 text-lg max-w-3xl mx-auto">
          Proteção veicular acessível da iGreen Seguros — planos completos, ativação rápida e
          comissão por apólice para o licenciado
        </p>
      </div>

      <img
        src="/conexao/conexao-seguros/COPIA-DE-4.webp"
        alt="Conexão Seguros"
        loading="lazy"
        className="rounded-2xl w-full max-w-2xl mx-auto mb-8 shadow-lg transition-transform duration-500 hover:scale-[1.02]"
        style={{ boxShadow: "var(--shadow-card)" }}
      />

      <div className="glass-card max-w-3xl mx-auto mb-12">
        <h3 className="section-heading text-2xl md:text-3xl mb-8 !text-left">Por que oferecer Seguros?</h3>
        <div className="space-y-4">
          {aboutItems.map((item, i) => (
            <div key={i} className="benefit-item">
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <h3 className="section-heading text-2xl md:text-3xl mb-8">
        Como você é remunerado com a Conexão Seguros?
      </h3>
      <div className="max-w-3xl mx-auto">
        <CommissionBlock
          title="Por apólice"
          items={[
            "Comissão sobre cada apólice vendida (conforme tabela vigente da iGreen Seguros)",
            "Renda recorrente enquanto a apólice permanece ativa",
          ]}
        />
        <CareerTable
          label="Plano de Carreira — Conexão Seguros:"
          items={[
            "S-Expansão ou Sênior: bônus adicional na tabela",
            "Gestor / Executivo / Diretor: percentuais crescentes na carreira",
            "Acionista: maior participação sobre a produção",
          ]}
        />
      </div>
    </div>
  </section>
);

export default LicConexaoSeguros;
