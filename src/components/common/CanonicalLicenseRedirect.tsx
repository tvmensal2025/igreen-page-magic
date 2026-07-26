import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * Se a URL usou slug curto/errado e o consultor foi resolvido por prefixo,
 * redireciona para a licença canônica preservando o resto do path.
 */
export function CanonicalLicenseRedirect({
  paramLicense,
  canonicalLicense,
}: {
  paramLicense: string | undefined;
  canonicalLicense: string | null | undefined;
}) {
  const location = useLocation();
  if (!paramLicense || !canonicalLicense) return null;
  if (paramLicense === canonicalLicense) return null;

  const escaped = paramLicense.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextPath = location.pathname.replace(
    new RegExp(`/${escaped}(?=/|$)`),
    `/${canonicalLicense}`,
  );
  if (nextPath === location.pathname) return null;
  return <Navigate to={`${nextPath}${location.search}`} replace />;
}

export function useLicenseParam() {
  return useParams<{ licenca: string }>().licenca;
}
