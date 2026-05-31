import { cn } from "@/lib/utils";

const LOGO_SRC = "/images/logo-colorida-igreen.png";

interface BrandLogoProps {
  className?: string;
  alt?: string;
  /** Renderiza como link para a rota informada (ex.: "/admin"). */
  to?: string;
}

/**
 * Logo da iGreen centralizado em um único componente. Antes o caminho
 * "/images/logo-colorida-igreen.png" estava espalhado e duplicado em ~6 páginas,
 * cada uma com um tamanho/markup diferente.
 */
const BrandLogo = ({ className, alt = "iGreen Energy", to }: BrandLogoProps) => {
  const img = (
    <img
      src={LOGO_SRC}
      alt={alt}
      width={300}
      height={92}
      className={cn("w-auto", className)}
    />
  );

  if (to) {
    return (
      <a href={to} aria-label={alt} className="inline-flex shrink-0">
        {img}
      </a>
    );
  }

  return img;
};

export default BrandLogo;
