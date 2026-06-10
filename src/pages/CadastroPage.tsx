import { useParams } from "react-router-dom";
import { useConsultant } from "@/hooks/useConsultant";
import { useTrackView } from "@/hooks/useTrackView";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Smartphone, Camera, FileText, CheckCircle2, Zap, Shield, Clock, Users, Printer, Sun, Leaf } from "lucide-react";
import LoadingScreen from "@/components/LoadingScreen";
import SEOHead from "@/components/SEOHead";
import PixelInjector from "@/components/PixelInjector";
import PageStatus from "@/components/common/PageStatus";
import BrandLogo from "@/components/common/BrandLogo";
import { SolarPanelSVG, SunRaysSVG } from "@/components/SolarPanelDecoration";

const G_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="white"/><text x="20" y="28" text-anchor="middle" font-family="Arial Black,sans-serif" font-size="26" font-weight="900" fill="#00B74F">G</text></svg>'
)}`;

const CadastroPage = () => {
  const { licenca } = useParams<{ licenca: string }>();
  const { data: consultant, isLoading } = useConsultant(licenca || "");
  const [isVisible, setIsVisible] = useState(false);
  const [showPrintView, setShowPrintView] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  
  useTrackView(consultant?.id, "cadastro");
  const { data: instancePhone } = useInstancePhone(consultant?.id);
  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handlePrint = useCallback(() => {
    setShowPrintView(true);
    // Pré-carrega a imagem de fundo antes de abrir o diálogo de impressão.
    // Sem isso, no primeiro clique a imagem ainda não está decodificada e o PDF sai em branco.
    const preload = new Image();
    preload.src = "/images/mutirao-lei-14300.jpg";
    const triggerPrint = () => {
      // Pequeno delay extra para garantir que o React renderizou o print-page
      setTimeout(() => {
        window.print();
        setTimeout(() => setShowPrintView(false), 500);
      }, 150);
    };
    if (preload.complete && preload.naturalWidth > 0) {
      triggerPrint();
    } else {
      preload.onload = triggerPrint;
      preload.onerror = triggerPrint; // não trava se falhar
    }
  }, []);

  if (isLoading) return <LoadingScreen />;

  if (!consultant) {
    return (
      <PageStatus
        title="Consultor não encontrado"
        description="Verifique o link e tente novamente."
      />
    );
  }

  // Priorizar connected_phone da instância; fallback para telefone do perfil com prefixo 55
  const fallbackPhone = consultant.phone?.replace(/\D/g, '') || "";
  const normalizedFallback = fallbackPhone.startsWith("55") ? fallbackPhone : `55${fallbackPhone}`;
  const phoneNumber = instancePhone || normalizedFallback;

  const botMessage = encodeURIComponent(
    "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz."
  );

  const whatsappBotUrl = `https://wa.me/${phoneNumber}?text=${botMessage}`;

  // URL de redirect eterno para o QR impresso — sempre aponta para o WhatsApp atual
  // da instância do consultor. Se trocar de número, basta atualizar no admin: os panfletos continuam valendo.
  const printQrUrl = `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/qr-redirect?l=${encodeURIComponent(licenca || "")}`;

  // Print view - A4 page for printing (Mutirão Lei 14.300 com QR dinâmico do consultor)
  if (showPrintView) {
    const consultantPhoneFormatted = (() => {
      const digits = phoneNumber.replace(/\D/g, '');
      // 55DDDNNNNNNNNN -> +55 (DD) NNNNN-NNNN
      if (digits.length >= 12) {
        const cc = digits.slice(0, 2);
        const ddd = digits.slice(2, 4);
        const rest = digits.slice(4);
        const mid = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
        const end = rest.length === 9 ? rest.slice(5) : rest.slice(4);
        return `+${cc} (${ddd}) ${mid}-${end}`;
      }
      return consultant.phone || '';
    })();

    return (
      <div className="print-page" ref={printRef}>
        <style>{`
          @media print {
            @page { size: A4; margin: 0; }
            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .print-page { width: 210mm; height: 297mm; }
          }
          .print-page {
            width: 210mm;
            height: 297mm;
            margin: 0 auto;
            font-family: 'Arial', sans-serif;
            position: relative;
            overflow: hidden;
            background: white;
          }
        `}</style>

        {/* Background: Mutirão Lei 14.300 banner em A4 */}
        <img
          src="/images/mutirao-lei-14300.jpg"
          alt=""
          onError={(e) => console.error('[Print] Falha ao carregar banner:', e)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />

        {/* QR Code real do consultor — posicionado no espaço livre à direita, sem cobrir a Aliança */}
        <div
          style={{
            position: 'absolute',
            left: '5%',
            bottom: '20%',
            width: '24%',
            aspectRatio: '1 / 1',
            background: 'white',
            borderRadius: '12px',
            padding: '12px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            border: '3px solid #FFD700',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <QRCodeSVG
            value={printQrUrl}
            size={500}
            level="H"
            includeMargin={false}
            fgColor="#000000"
            bgColor="#ffffff"
            style={{ width: '100%', height: '100%' }}
            imageSettings={{
              src: G_LOGO_DATA_URI,
              height: 60,
              width: 60,
              excavate: true,
            }}
          />
        </div>

        {/* Faixa do licenciado — posicionada acima da Aliança, sem cobri-la */}
        <div
          style={{
            position: 'absolute',
            left: '5%',
            right: '5%',
            bottom: '13%',
            background: 'rgba(0, 40, 18, 0.95)',
            padding: '8px 16px',
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: 'white',
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '12px',
            letterSpacing: '0.5px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            zIndex: 2,
            border: '1px solid rgba(255,215,0,0.4)',
          }}
        >
          <span style={{ fontWeight: 900 }}>
            LICENCIADO: {consultant.name?.toUpperCase()}
            {consultant.igreen_id ? ` • ID ${consultant.igreen_id}` : ''}
          </span>
          <span style={{ fontWeight: 900 }}>WHATSAPP: {consultantPhoneFormatted}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <PixelInjector 
        facebookPixelId={consultant.facebook_pixel_id} 
        googleAnalyticsId={consultant.google_analytics_id} 
      />
      <SEOHead
        title={`Economize até 20% na Conta de Luz - ${consultant.name} | iGreen Energy`}
        description={`Cadastre-se e tenha de 8% a 20% de desconto na conta de luz. Cadastro rápido em 3 minutos via WhatsApp com ${consultant.name}.`}
      />

      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <BrandLogo className="h-10 md:h-12" />
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Seu consultor</p>
              <p className="font-bold text-foreground sensitive-name">{consultant.name}</p>
            </div>
          </div>
        </header>

        {/* Hero Section - QR Code centralizado */}
        <section 
          className={`relative overflow-hidden transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          {/* Background with solar panels photo */}
          <div className="absolute inset-0">
            <img src="/images/solar-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ 
              background: 'linear-gradient(160deg, rgba(0,26,13,0.85) 0%, rgba(0,61,26,0.75) 30%, rgba(0,107,45,0.7) 60%, rgba(0,77,26,0.85) 100%)',
            }} />
          </div>
          
          {/* Decorations */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <SolarPanelSVG className="absolute -top-8 -right-8 w-56 h-56 text-white opacity-[0.04] rotate-12 animate-[float_8s_ease-in-out_infinite]" />
            <SolarPanelSVG className="absolute -bottom-12 -left-12 w-72 h-72 text-white opacity-[0.03] -rotate-12 animate-[float_10s_ease-in-out_infinite_1s]" />
            <SolarPanelSVG className="absolute top-20 -left-6 w-36 h-36 text-white opacity-[0.03] rotate-45 animate-[float_12s_ease-in-out_infinite_2s]" />
            <SunRaysSVG className="absolute -top-16 left-1/2 -translate-x-1/2 w-[600px] h-[600px] text-primary opacity-[0.08]" />
            
            {/* Glow orbs */}
            <div className="absolute top-20 right-[10%] w-80 h-80 rounded-full opacity-20"
              style={{ background: 'radial-gradient(circle, #00B74F, transparent 70%)' }}
            />
            <div className="absolute bottom-10 left-[5%] w-60 h-60 rounded-full opacity-10"
              style={{ background: 'radial-gradient(circle, #FFD700, transparent 70%)' }}
            />
          </div>

          <div className="container mx-auto px-4 py-16 md:py-24 relative z-10">
            {/* Badge */}
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 bg-primary/20 backdrop-blur-md px-5 py-2.5 rounded-full border border-primary/30">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                </span>
                <span className="text-primary text-sm font-semibold tracking-wide">ECONOMIA GARANTIDA</span>
              </div>
            </div>

            {/* Logo */}
            <div className="flex justify-center mb-6">
              <BrandLogo className="h-16 md:h-20" />
            </div>

            {/* Title */}
            <h1 className="text-center mb-3">
              <span className="block text-3xl md:text-5xl lg:text-6xl font-black text-white font-heading leading-tight">
                Cadastre-se e tenha{" "}
                <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg, #FF8C00, #FFD700, #FF8C00)' }}>
                  8% a 20% de desconto
                </span>
              </span>
              <span className="block text-2xl md:text-4xl lg:text-5xl font-black text-white font-heading mt-2">
                na sua conta de luz
              </span>
            </h1>

            <p className="text-white/70 text-center text-base md:text-lg max-w-2xl mx-auto mb-10">
              Sem instalar placas solares, sem obras, sem custos — energia solar por assinatura com cadastro em 3 minutos
            </p>

            {/* QR Code Card - Centralizado como hero principal */}
            <div className="max-w-md mx-auto mb-10">
              <div className="relative bg-white rounded-3xl p-6 md:p-8 shadow-2xl"
                style={{
                  boxShadow: '0 0 60px rgba(0, 183, 79, 0.25), 0 25px 80px rgba(0,0,0,0.3)'
                }}
              >
                {/* Glow border */}
                <div className="absolute -inset-[2px] rounded-3xl bg-gradient-to-br from-primary/40 via-transparent to-warning/30 -z-10 blur-sm" />

                <div className="flex flex-col items-center">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-1 font-heading">
                    📱 Escaneie o QR Code
                  </h2>
                  <p className="text-gray-500 text-sm mb-5">
                    Aponte a câmera do celular e cadastre-se agora
                  </p>

                  {/* QR Code */}
                  <div className="relative bg-white p-3 rounded-2xl shadow-inner mb-5 border-4 border-primary/30">
                    <QRCodeSVG
                      value={whatsappBotUrl}
                      size={typeof window !== 'undefined' && window.innerWidth < 768 ? 200 : 240}
                      level="H"
                      includeMargin={true}
                      fgColor="#1a1a1a"
                      imageSettings={{
                        src: G_LOGO_DATA_URI,
                        height: 45,
                        width: 45,
                        excavate: true,
                      }}
                    />
                  </div>

                  {/* Mobile WhatsApp button */}
                  <a
                    href={whatsappBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lg:hidden w-full bg-[#25D366] hover:bg-[#20BA5A] text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg mb-3"
                  >
                    <Smartphone className="w-5 h-5" />
                    Abrir WhatsApp Agora
                  </a>

                  {/* Desktop link */}
                  <div className="hidden lg:block text-center mb-4">
                    <p className="text-gray-400 text-xs mb-1">Ou acesse pelo celular:</p>
                    <a href={whatsappBotUrl} className="text-[#25D366] hover:text-[#20BA5A] font-semibold text-sm underline inline-flex items-center gap-1">
                      <Smartphone className="w-3.5 h-3.5" />
                      Clique aqui para abrir
                    </a>
                  </div>

                  {/* Consultant info */}
                  <div className="pt-4 border-t border-gray-100 w-full text-center">
                    <p className="text-gray-400 text-xs">Consultor(a)</p>
                    <p className="text-gray-900 font-bold">{consultant.name}</p>
                    {consultant.igreen_id && (
                      <p className="text-gray-400 text-xs">ID: {consultant.igreen_id}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Botão Gerar PDF */}
            <div className="flex justify-center mb-8">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white font-semibold py-3 px-6 rounded-full border border-white/20 transition-all hover:scale-105"
              >
                <Printer className="w-5 h-5" />
                Gerar PDF para Imprimir
              </button>
            </div>

            {/* 3 Steps inline */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto mb-8">
              {[
                { icon: Camera, num: "1", title: "Escaneie o QR Code", desc: "Use a câmera do celular" },
                { icon: FileText, num: "2", title: "Envie Documentos", desc: "RG ou CNH + conta de luz" },
                { icon: CheckCircle2, num: "3", title: "Pronto!", desc: "Cadastro em 3 minutos" },
              ].map((step) => (
                <div key={step.num} className="flex flex-col items-center text-center bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-3 border border-primary/30">
                    <step.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-white font-bold text-sm mb-1">{step.title}</h3>
                  <p className="text-white/60 text-xs">{step.desc}</p>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="flex justify-center gap-8 md:gap-16">
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-black text-white">600mil+</div>
                <div className="text-white/50 text-xs uppercase tracking-wider">Clientes</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-black text-white">500+</div>
                <div className="text-white/50 text-xs uppercase tracking-wider">Usinas</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-black text-white">27</div>
                <div className="text-white/50 text-xs uppercase tracking-wider">Estados</div>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-16 md:py-20 section-gradient">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl md:text-4xl font-black text-foreground text-center mb-3 font-heading">
              Por que fazer seu cadastro agora?
            </h2>
            <p className="text-muted-foreground text-center text-base mb-12 max-w-2xl mx-auto">
              Junte-se a mais de 600 mil clientes que já economizam na conta de luz
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
              {[
                { icon: Zap, title: "Economia Garantida", desc: "De 8% a 20% de desconto todo mês na sua conta de luz" },
                { icon: Clock, title: "Rápido e Fácil", desc: "Cadastro completo em 3 minutos pelo WhatsApp" },
                { icon: Shield, title: "100% Seguro", desc: "Dados protegidos com criptografia de ponta" },
                { icon: Users, title: "600mil+ Clientes", desc: "Maior rede de energia solar do Brasil" },
              ].map((b) => (
                <div key={b.title} className="glass-card group hover:border-primary/30 transition-all">
                  <div className="w-14 h-14 rounded-xl bg-primary/15 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <b.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="font-bold text-foreground text-lg mb-2">{b.title}</h3>
                  <p className="text-muted-foreground text-sm">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works - detailed steps */}
        <section className="py-16 md:py-20 bg-background">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl md:text-4xl font-black text-foreground text-center mb-3 font-heading">
              Como funciona o processo?
            </h2>
            <p className="text-muted-foreground text-center text-base mb-12 max-w-2xl mx-auto">
              Passo a passo do seu cadastro
            </p>

            <div className="max-w-3xl mx-auto space-y-4">
              {[
                { step: "1", title: "Escaneie o QR Code", description: "Use a câmera do celular para escanear. O WhatsApp abre automaticamente." },
                { step: "2", title: "Converse com o Bot", description: "Nosso assistente virtual vai te guiar em cada etapa do cadastro." },
                { step: "3", title: "Envie RG ou CNH", description: "RG: frente e verso. CNH: apenas a frente. O sistema extrai os dados automaticamente." },
                { step: "4", title: "Envie a Conta de Energia", description: "Foto da última fatura. Extraímos endereço, consumo e distribuidora." },
                { step: "5", title: "Confirme os Dados", description: "Revise as informações extraídas e confirme." },
                { step: "6", title: "Receba o Link", description: "Em minutos você recebe o link para assinar e ativar seu desconto!" },
              ].map((item) => (
                <div key={item.step} className="flex gap-4 items-start premium-card hover:border-primary/20 transition-colors">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-base mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Final */}
        <section className="py-16 md:py-20 relative overflow-hidden" style={{
          background: 'linear-gradient(135deg, #003d1a 0%, #006B2D 50%, #004d1a 100%)'
        }}>
          <SolarPanelSVG className="absolute -bottom-10 -right-10 w-48 h-48 text-white opacity-[0.04] rotate-12" />
          
          <div className="container mx-auto px-4 text-center relative z-10">
            <h2 className="text-2xl md:text-4xl font-black text-white mb-4 font-heading">
              Pronto para economizar?
            </h2>
            <p className="text-white/70 text-base mb-8 max-w-xl mx-auto">
              Escaneie o QR Code agora e comece a ter desconto na sua conta de luz
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center justify-center gap-2 bg-primary/100 hover:bg-primary text-white font-bold py-4 px-8 rounded-xl transition-colors shadow-lg"
              >
                <Camera className="w-5 h-5" />
                Voltar ao QR Code
              </button>
              <button
                onClick={handlePrint}
                className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold py-4 px-8 rounded-xl border border-white/20 transition-all"
              >
                <Printer className="w-5 h-5" />
                Imprimir QR Code
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-card py-10 text-center border-t border-border">
          <BrandLogo className="mx-auto mb-4 w-36" />
          <p className="text-muted-foreground text-sm tracking-wider sensitive-name">
            {consultant.name.toUpperCase()} | CONSULTOR(A) IGREEN ENERGY
            {consultant.igreen_id && ` ID ${consultant.igreen_id}`}
          </p>
          <p className="text-muted-foreground/60 text-xs mt-2">
            © {new Date().getFullYear()} iGreen Energy. Todos os direitos reservados.
          </p>
        </footer>
      </div>
    </>
  );
};

export default CadastroPage;
