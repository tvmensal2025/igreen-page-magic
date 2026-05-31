import { ReactNode } from "react";
import BrandLogo from "@/components/common/BrandLogo";

interface AppHeaderProps {
  /** Título principal exibido ao lado do logo (oculto no mobile). */
  title?: string;
  /** Subtítulo abaixo do título (ex.: nome do consultor). */
  subtitle?: string;
  /** Marca o subtítulo como dado sensível (blur no modo privacidade). */
  subtitleSensitive?: boolean;
  /** Ações à direita (toggles, notificações, sair...). */
  actions?: ReactNode;
  /** Largura máxima do conteúdo interno. Default acomoda telas ultrawide. */
  maxWidthClassName?: string;
}

/**
 * Cabeçalho padrão dos painéis internos (admin/super-admin). Centraliza o
 * markup de logo + título + área de ações que antes era reimplementado em
 * cada página, cada uma com tamanhos de logo e estrutura divergentes.
 */
const AppHeader = ({
  title,
  subtitle,
  subtitleSensitive = false,
  actions,
  maxWidthClassName = "max-w-[1760px]",
}: AppHeaderProps) => (
  <header className="z-50 shrink-0 border-b border-border bg-card/80 backdrop-blur-xl">
    <div className={`${maxWidthClassName} mx-auto flex items-center justify-between px-3 py-2 sm:px-5 lg:px-6`}>
      <div className="flex items-center gap-3">
        <BrandLogo className="w-20 sm:w-24" />
        {(title || subtitle) && (
          <div className="hidden sm:block">
            {title && (
              <h1 className="font-heading text-base font-bold leading-tight text-foreground">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className={`text-xs text-muted-foreground ${subtitleSensitive ? "sensitive-name" : ""}`}>
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-0.5 sm:gap-1">{actions}</div>
      )}
    </div>
  </header>
);

export default AppHeader;
