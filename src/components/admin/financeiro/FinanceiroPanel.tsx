import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { FinanceiroTabs, type FinanceiroSubTab } from "./FinanceiroTabs";
import { BoletosPanel } from "./BoletosPanel";

const RecebiveisPanel = lazy(() => import("./RecebiveisPanel").then((m) => ({ default: m.RecebiveisPanel })));
const CarteiraGreenAdminPanel = lazy(() =>
  import("./CarteiraGreenAdminPanel").then((m) => ({ default: m.CarteiraGreenAdminPanel })),
);
const ExtratoPanel = lazy(() => import("./ExtratoPanel").then((m) => ({ default: m.ExtratoPanel })));

function readInitialSub(): FinanceiroSubTab {
  if (typeof window === "undefined") return "boletos";
  const sp = new URLSearchParams(window.location.search);
  const sub = sp.get("sub");
  if (sub === "recebiveis" || sub === "carteira" || sub === "extrato") return sub;
  return "boletos";
}

/**
 * Aba Financeiro do /admin. Nav interna:
 *   - Boletos      (padrão)
 *   - Recebíveis   (Ganhos Conexão Green)
 *   - Carteira     (adimplência + métricas iGreen)
 *   - Extrato      (wallet_transactions + recargas manuais — só admin)
 */
export function FinanceiroPanel({ userId }: { userId: string }) {
  const { isSuperAdmin, isAdmin, loading: roleLoading } = useUserRole(userId);
  const canAdmin = isSuperAdmin || isAdmin;
  const scope: "all" | "self" = canAdmin ? "all" : "self";
  const [sub, setSub] = useState<FinanceiroSubTab>(() => readInitialSub());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sub === "boletos") sp.delete("sub");
    else sp.set("sub", sub);
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [sub]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
      </div>
    );
  }

  const effectiveSub: FinanceiroSubTab = sub === "extrato" && !canAdmin ? "boletos" : sub;

  return (
    <div className="space-y-5">
      <FinanceiroTabs active={effectiveSub} onChange={setSub} isAdmin={canAdmin} />

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
          </div>
        }
      >
        {effectiveSub === "boletos" && <BoletosPanel userId={userId} scope={scope} />}
        {effectiveSub === "recebiveis" && <RecebiveisPanel consultantId={userId} />}
        {effectiveSub === "carteira" && (
          <CarteiraGreenAdminPanel userId={userId} canPickConsultant={canAdmin} />
        )}
        {effectiveSub === "extrato" && canAdmin && <ExtratoPanel userId={userId} isAdmin={canAdmin} />}
      </Suspense>
    </div>
  );
}
