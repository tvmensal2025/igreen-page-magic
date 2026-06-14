import { cn } from "@/lib/utils";

/**
 * Tipo de dado sensível. Define qual classe do modo privacidade é aplicada.
 * As classes correspondentes vivem em `src/index.css` (seção "Privacy Mode").
 */
export type SensitiveKind =
  | "name"
  | "phone"
  | "cpf"
  | "email"
  | "address"
  | "value"
  | "data";

const KIND_CLASS: Record<SensitiveKind, string> = {
  name: "sensitive-name",
  phone: "sensitive-phone",
  cpf: "sensitive-cpf",
  email: "sensitive-email",
  address: "sensitive-address",
  value: "sensitive-value",
  data: "sensitive-data",
};

interface SensitiveProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Categoria do dado. Define a classe de borrão aplicada no modo privacidade. */
  kind?: SensitiveKind;
  /** Elemento renderizado. Default: span. Use "div" para blocos. */
  as?: "span" | "div";
  children: React.ReactNode;
}

/**
 * Envolve qualquer dado sensível (PII ou valor monetário) para que ele seja
 * borrado quando o modo privacidade (o "olho" no topo) estiver ativo.
 *
 * Quando o modo privacidade está desligado, é um wrapper transparente: não
 * altera layout nem estilo além de aplicar a classe.
 *
 * Exemplos:
 *   <Sensitive kind="name">{cliente.nome}</Sensitive>
 *   <Sensitive kind="value">{formatCurrencyBRL(comissao)}</Sensitive>
 */
export function Sensitive({
  kind = "data",
  as = "span",
  className,
  children,
  ...props
}: SensitiveProps) {
  const Tag = as;
  return (
    <Tag className={cn(KIND_CLASS[kind], className)} {...props}>
      {children}
    </Tag>
  );
}
