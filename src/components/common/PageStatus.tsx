import { ReactNode } from "react";
import BrandLogo from "@/components/common/BrandLogo";

interface PageStatusProps {
  title: string;
  description?: string;
  /** Ações opcionais (botões/links) renderizadas abaixo da descrição. */
  children?: ReactNode;
  /** Anima o logo (usado em telas de carregamento). */
  pulse?: boolean;
}

/**
 * Estado de página centralizado e consistente: logo + título + descrição.
 * Substitui os blocos "não encontrado" copiados/colados em ConsultantPage,
 * LicenciadaPage e CadastroPage, além das telas de loading/aprovação do Admin.
 */
const PageStatus = ({ title, description, children, pulse = false }: PageStatusProps) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
    <BrandLogo className={pulse ? "w-32 animate-pulse" : "w-32 opacity-60"} />
    <div className="space-y-2">
      <h1 className="font-heading text-2xl font-bold text-foreground">{title}</h1>
      {description && (
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {children}
  </div>
);

export default PageStatus;
