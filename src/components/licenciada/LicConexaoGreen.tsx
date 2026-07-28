import CommissionBlock from "./CommissionBlock";
import CareerTable from "./CareerTable";
import LazyVideo from "@/components/ui/LazyVideo";

const howItWorks = [
  "Nossas usinas produzem energia solar, a energia é injetada na rede da distribuidora, a distribuidora envia a energia para a casa ou empresa dos clientes, os clientes economizam de forma gratuita sem investimentos",
  "Como a nossa energia solar é mais barata do que a energia hidrelétrica normalmente utilizada pelas distribuidoras, nós conseguimos oferecer um desconto de até 20% por mês para nossos clientes",
  "Os clientes não pagam nenhum centavo para ter acesso a esses descontos, não precisam instalar placas solares, não alteramos sua instalação de energia, não tem obras, não tem taxa de adesão, não tem mensalidade, não tem fidelidade. Todo o cadastro é 100% online e gratuito",
  "Nós atendemos casas, apartamentos, prédios, condomínios, fazendas, comércios e empresas",
  "Nosso trabalho está regulamentado pela Lei Federal 14.300 de 6 de Janeiro de 2022. Os consumidores já podem escolher o tipo de energia que desejam utilizar em suas residências e empresas, se é a energia hidrelétrica ou a energia solar renovável e mais barata",
];

const solarPlants = [
  "Temos mais de 500 usinas espalhadas pelo Brasil produzindo energia limpa, sustentável e mais barata",
  "E o melhor de tudo, reduzindo toneladas de CO2 no meio ambiente",
];

const states = [
  "Minas Gerais (CEMIG)", "Minas Gerais (Energisa Minas Rio)", "São Paulo (Energisa)", "São Paulo (CPFL)",
  "São Paulo (CPFL Santa Cruz)", "São Paulo (Elektro)", "Rio de Janeiro (Energisa Minas-Rio)",
  "Rio de Janeiro (Enel)", "Espírito Santo (EDP)", "Goiás (Equatorial)", "Mato Grosso (Energisa)",
  "Mato Grosso do Sul (Energisa)", "Paraná (Copel)", "Santa Catarina (Celesc)", "Rio Grande do Sul (CEEE)",
  "Rio Grande do Sul (RGE)", "Alagoas (Equatorial)", "Ceará (Enel)", "Paraíba (Energisa)",
  "Pernambuco (Neoenergia)", "Rio Grande do Norte (Cosern)", "Piauí (Equatorial)", "Maranhão (Equatorial)",
  "Bahia (Coelba)", "Sergipe (Energisa)", "Tocantins (Energisa)",
];

const careerLevels = [
  "S-Expansão ou Sênior: + 0,2%", "G-Expansão: + 0,3%", "Gestor: + 0,5%", "E-Expansão: + 0,6%",
  "Executivo: + 0,8%", "D-Expansão: + 1%", "Diretor: + 1,4%", "Acionista: + 1,8%",
];

const LicConexaoGreen = () => (
  <section>
    <div className="section-container">
      <div className="text-center mb-12">
        <div className="product-number mx-auto mb-4">1</div>
        <h2 className="section-heading mb-4">Conexão Green</h2>
        <p className="text-foreground/70 text-lg max-w-3xl mx-auto">
          Serviço prestado pela iGreen que conecta o cliente a uma de nossas usinas solares, oferecendo um desconto de até 20% na conta de luz todos os meses gratuitamente
        </p>
      </div>

      <img src="/images/conexao-green.webp" alt="Conexão Green" loading="lazy" className="rounded-2xl w-full max-w-2xl mx-auto mb-16 shadow-lg transition-transform duration-500 hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-card)' }} />

      <div className="glass-card mb-16">
        <h3 className="section-heading text-2xl md:text-3xl mb-10 !text-left">Como funciona a Conexão Green</h3>
        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div className="space-y-4">
            {howItWorks.map((s, i) => <div key={i} className="benefit-item"><span>{s}</span></div>)}
          </div>
          <img src="/images/foto-12-como-funciona.jpeg" alt="Como funciona" loading="lazy" className="rounded-xl w-full shadow-lg" style={{ boxShadow: 'var(--shadow-card)' }} />
        </div>
      </div>

      <div className="text-center mb-16">
        <h3 className="section-heading text-2xl md:text-3xl mb-8">Nossas usinas solares</h3>
        <div className="max-w-2xl mx-auto space-y-4 mb-12">
          {solarPlants.map((s, i) => <div key={i} className="benefit-item justify-center"><span>{s}</span></div>)}
        </div>
        <h3 className="section-heading text-xl md:text-2xl mb-4">Conheça a UFV Hélio Valgas</h3>
        <p className="text-muted-foreground text-lg mb-8">Nossa usina solar em Várzea da Palma MG</p>
        <div className="max-w-3xl mx-auto rounded-2xl overflow-hidden relative" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
          <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
          <LazyVideo src="/videos/usina-helio-valgas.mp4" />
        </div>
      </div>

      <div className="mb-16">
        <h3 className="section-heading text-2xl md:text-3xl mb-8">Atualmente nós atendemos os seguintes estados</h3>
        <img src="/images/imagem-3.jpeg" alt="Mapa do Brasil" loading="lazy" className="rounded-xl mx-auto max-w-lg w-full mb-12 shadow-lg" style={{ boxShadow: 'var(--shadow-card)' }} />

        <h3 className="section-heading text-xl md:text-2xl mb-4">Critérios para cadastros de clientes</h3>
        <p className="text-foreground/70 text-center max-w-3xl mx-auto mb-8">
          Para a iGreen oferecer os descontos na conta de luz de Clientes CPF e CNPJ, é realizada uma média sobre o consumo de energia dos últimos 12 meses do Cliente
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl mx-auto">
          {states.map((s, i) => (
            <div key={i} className="glass-card !p-4 !rounded-xl">
              <p className="font-heading font-bold text-sm uppercase mb-1" style={{ color: 'hsl(var(--primary))' }}>{s}</p>
              <p className="text-foreground/60 text-xs">CPF e CNPJ · Mín. 130 kWh</p>
            </div>
          ))}
        </div>
      </div>

      <div className="green-divider-glow mb-12" />
      <h3 className="section-heading text-2xl md:text-3xl mb-8">Como você é remunerado com a Conexão Green?</h3>
      <p className="text-foreground/70 text-center mb-8">As porcentagens de comissão sobre as contas de luz dependem do Estado e da Distribuidora de Energia</p>

      <div className="max-w-3xl mx-auto">
        <CommissionBlock title="CP (Conexão Própria)" items={[
          "4% de comissão recorrente: MG (CEMIG), MG (Energisa), RJ (Enel), RJ (Energisa), SP (Elektro, Energisa, EDP, CPFL), GO (Equatorial), MT, MS, AL, CE, PE, RN, PI, PB, MA, BA, PA, RS (RGE), PR, SC, TO",
          "2% de comissão recorrente: ES (EDP), RS (CEEE), SE (Energisa)",
        ]} />
        <CommissionBlock title="CI (Conexão Indireta — Licenciados Diretos)" items={[
          "1% de comissão recorrente: maioria dos estados",
          "0,5% de comissão recorrente: ES (EDP), RS (CEEE), SE (Energisa)",
        ]} />
        <CareerTable label="À medida que você cresce no Plano de Carreira, suas comissões aumentam:" items={careerLevels} />
      </div>
    </div>
  </section>
);

export default LicConexaoGreen;
