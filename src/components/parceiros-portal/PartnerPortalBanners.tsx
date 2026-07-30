import { useState } from "react";
import {
  BannerNamesTable,
  type BannerNameRow,
} from "@/components/admin/parceiros/BannerNamesTable";
import {
  PartnerPortalDownloadModal,
  type PortalDownloadTarget,
} from "./PartnerPortalDownloadModal";

export function PartnerPortalBanners({
  rows,
  partnerName,
  shortCode,
  refLabel,
  consultantName,
  consultantIgreenId,
  consultantPhone,
}: {
  rows: BannerNameRow[];
  partnerName: string;
  shortCode: string;
  refLabel: string;
  consultantName: string;
  consultantIgreenId: string;
  consultantPhone: string;
}) {
  const [target, setTarget] = useState<PortalDownloadTarget | null>(null);

  const handleRowClick = (row: BannerNameRow) => {
    if (row.kind === "arquivado") return;
    if (row.kind === "geral") {
      setTarget({ kind: "geral", name: row.name });
      return;
    }
    if (row.key.startsWith("kw:")) return;
    setTarget({
      kind: "local",
      name: row.name,
      code: row.code,
      keyword: row.name,
    });
  };

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
      <div className="mb-3">
        <h2 className="font-heading text-lg font-bold text-white">Seus banners</h2>
        <p className="text-xs text-emerald-100/50 mt-0.5">
          Clique no nome para baixar Folha A4 ou Banner 504×904. Locais
          arquivados ficam no histórico.
        </p>
      </div>
      <BannerNamesTable
        rows={rows}
        title="Nome · leituras · leads"
        emptyHint="Ainda sem leituras. Divulgue seu QR."
        onRowClick={handleRowClick}
        rowActionLabel="baixar"
      />
      <PartnerPortalDownloadModal
        open={!!target}
        onClose={() => setTarget(null)}
        partnerName={partnerName}
        shortCode={shortCode}
        refLabel={refLabel}
        consultantName={consultantName}
        consultantIgreenId={consultantIgreenId}
        consultantPhone={consultantPhone}
        target={target}
      />
    </section>
  );
}
