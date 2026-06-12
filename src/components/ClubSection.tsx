import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { useRef } from "react";
import LazyVideo from "@/components/ui/LazyVideo";

const banners = [
  { src: "/images/club-banner-1.png", alt: "Burger King – R$8 em pedidos no site" },
  { src: "/images/club-banner-2.png", alt: "Drogasil – Até 70% na medicação" },
  { src: "/images/club-banner-3.png", alt: "Marisa – Até 15% em produtos" },
  { src: "/images/club-banner-4.png", alt: "Kalunga – Até 19% em materiais" },
  { src: "/images/club-banner-5.png", alt: "Petz – Até 12% na ração" },
  { src: "/images/club-banner-6.png", alt: "Ray-Ban – Até 25% no óculos" },
  { src: "/images/club-banner-7.png", alt: "Vivara – Até 15%" },
];

const ClubSection = () => {
  const plugin = useRef(Autoplay({ delay: 3000, stopOnInteraction: false }));

  return (
    <section>
      <div className="section-container">
        <div className="badge-green mx-auto mb-6">Benefícios</div>
        <h2 className="section-heading mb-14">Acesso gratuito ao iGreen Club</h2>

        <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden relative mb-14" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
          <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
          <LazyVideo src="https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/club-de-beneficios.mp4" poster="/videos/posters/club-de-beneficios.webp" />
        </div>

        <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden relative mb-14" style={{ boxShadow: 'var(--shadow-green-lg)' }}>
          <div className="absolute inset-0 rounded-2xl border border-primary/20 z-10 pointer-events-none" />
          <LazyVideo src="https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/igreen_club_3.mp4" poster="/videos/posters/igreen_club_3.webp" />
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-5 mb-14">
            <div className="glass-card text-center">
              <div className="text-4xl mb-3">🛍️</div>
              <p className="text-foreground/90 leading-relaxed">
                Além de pagar menos na energia, aproveite vantagens exclusivas, experiências imperdíveis e preços especiais no <strong className="text-primary">iGreen Club</strong>
              </p>
            </div>
            <div className="glass-card text-center">
              <div className="text-4xl mb-3">🏪</div>
              <p className="text-foreground/90 leading-relaxed">
                Descontos em mais de <strong className="text-primary">600 mil produtos</strong> e serviços em <strong className="text-primary">60 mil lojas</strong> parceiras em todo o Brasil
              </p>
            </div>
          </div>

          <h3 className="section-heading text-xl md:text-2xl mb-8">
            Confira algumas lojas onde os clientes iGreen tem descontos exclusivos
          </h3>

          <div className="max-w-3xl mx-auto rounded-2xl overflow-hidden border-4 border-primary mb-14">
            <img
              src="/images/lojas-parceiras.png"
              alt="Lojas parceiras iGreen Club - Pague Menos, Casas Bahia, Netshoes, Movida, Vivara, Electrolux, Magalu, Philips, Cinemark e mais"
              className="w-full"
              loading="lazy"
              decoding="async"
            />
          </div>

          {/* Carrossel de banners */}
          <Carousel
            plugins={[plugin.current]}
            opts={{ align: "start", loop: true }}
            className="max-w-4xl mx-auto"
          >
            <CarouselContent className="-ml-4">
              {banners.map((b, i) => (
                <CarouselItem key={i} className="pl-4 basis-full sm:basis-1/2 lg:basis-1/3">
                  <div className="rounded-2xl overflow-hidden border border-primary/20" style={{ boxShadow: 'var(--shadow-card)' }}>
                    <img src={b.src} alt={b.alt} className="w-full aspect-square object-cover" loading="lazy" decoding="async" />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="hidden sm:flex -left-12 border-primary/30 text-primary hover:bg-primary/10" />
            <CarouselNext className="hidden sm:flex -right-12 border-primary/30 text-primary hover:bg-primary/10" />
          </Carousel>
        </div>
      </div>
    </section>
  );
};

export default ClubSection;
