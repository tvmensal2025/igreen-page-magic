import { useEffect, useState } from "react";
import BrandLogo from "@/components/common/BrandLogo";

interface NavItem {
  label: string;
  href: string;
}

interface LandingNavProps {
  /** Links de âncora exibidos no centro (desktop). */
  items?: NavItem[];
  /** Texto do botão de CTA à direita. */
  ctaLabel?: string;
  /** URL do CTA. */
  ctaHref?: string;
  /** Callback de tracking ao clicar no CTA. */
  onCtaClick?: () => void;
}

/**
 * Navbar premium full-width para landing pages. Fica transparente no topo e
 * ganha fundo translúcido + borda ao rolar (padrão de SaaS moderno).
 */
const LandingNav = ({ items = [], ctaLabel, ctaHref, onCtaClick }: LandingNavProps) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`app-navbar ${scrolled ? "scrolled" : ""}`}>
      <div className="app-navbar-inner">
        <a href="#top" aria-label="iGreen Energy" className="flex items-center shrink-0">
          <BrandLogo className="w-24 md:w-28" />
        </a>

        {items.length > 0 && (
          <div className="hidden md:flex items-center gap-8">
            {items.map((item) => (
              <a key={item.href} href={item.href} className="nav-link">
                {item.label}
              </a>
            ))}
          </div>
        )}

        {ctaLabel && ctaHref && (
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onCtaClick}
            className="btn-cta !px-5 !py-2.5 !text-sm"
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </nav>
  );
};

export default LandingNav;
