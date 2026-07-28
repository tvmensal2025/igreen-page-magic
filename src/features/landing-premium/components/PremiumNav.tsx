import { useCallback, useState } from "react";
import BrandLogo from "@/components/common/BrandLogo";
import { NAV_ANCHORS } from "../content";
import { useScrolledPast } from "../useReveal";

interface PremiumNavProps {
  whatsappUrl: string;
  onWhatsAppClick: () => void;
}

/**
 * Navbar da LP premium. Transparente no topo (o hero respira) e ganha fundo
 * translúcido + borda ao rolar, para os links continuarem legíveis sobre
 * qualquer seção.
 *
 * Não reusa `LandingNav` de propósito: aquele componente é usado pela LP atual
 * e por outras landings. Estilizar ele aqui mudaria as outras páginas.
 */
const PremiumNav = ({ whatsappUrl, onWhatsAppClick }: PremiumNavProps) => {
  const [scrolled, setScrolled] = useState(false);
  const handleChange = useCallback((past: boolean) => setScrolled(past), []);
  useScrolledPast(20, handleChange);

  return (
    <header className="lpx-nav" data-scrolled={scrolled}>
      <div className="lpx-wrap lpx-nav__inner">
        <a href="#top" aria-label="Início — iGreen Energy" className="lpx-nav__brand">
          <BrandLogo className="w-[92px] md:w-[110px]" />
        </a>

        <nav className="lpx-nav__links" aria-label="Seções da página">
          {NAV_ANCHORS.map((item) => (
            <a key={item.href} href={item.href} className="lpx-nav__link">
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onWhatsAppClick}
          className="lpx-btn lpx-btn--primary lpx-nav__cta"
        >
          <span className="hidden sm:inline">Falar com o consultor</span>
          <span className="sm:hidden">WhatsApp</span>
        </a>
      </div>
    </header>
  );
};

export default PremiumNav;
