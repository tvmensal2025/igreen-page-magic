import { Navigate, useParams } from "react-router-dom";

/** /conexao-green/:licenca → /:licenca (LP cliente canônica) */
export function RedirectConexaoGreen() {
  const { licenca } = useParams<{ licenca: string }>();
  return <Navigate to={`/${licenca || ""}`} replace />;
}

/** /conexao-expansao/:licenca → /licenciado/:licenca (LP licenciado canônica) */
export function RedirectConexaoExpansao() {
  const { licenca } = useParams<{ licenca: string }>();
  return <Navigate to={`/licenciado/${licenca || ""}`} replace />;
}
