import { useState } from "react";
import { ResultsDashboard } from "./ResultsDashboard";
import { WalletChip } from "./WalletChip";
import { SyncMetricsButton } from "./SyncMetricsButton";
import { TrendingUp } from "lucide-react";
import { HardResetPhoneCard } from "@/components/admin/HardResetPhoneCard";

interface Props {
  consultantId: string;
  onGoToCentral?: () => void;
}

export function PerformanceTab({ consultantId, onGoToCentral }: Props) {
  // Bumpa esse contador pra forçar o ResultsDashboard a recarregar tudo após sync.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-5">
      <HardResetPhoneCard userId={consultantId} />
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
            Performance dos Anúncios
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Mostra <strong className="text-foreground">apenas leads e clientes atribuídos ao Meta Ads</strong> — ignora contatos por indicação, importação ou LP orgânica.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          <SyncMetricsButton
            consultantId={consultantId}
            onSynced={() => setRefreshKey((k) => k + 1)}
          />
          <WalletChip consultantId={consultantId} />
        </div>
      </header>

      <ResultsDashboard
        key={refreshKey}
        consultantId={consultantId}
        onCreateClick={onGoToCentral}
      />
    </div>
  );
}
