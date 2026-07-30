import {
  BannerNamesTable,
  type BannerNameRow,
} from "@/components/admin/parceiros/BannerNamesTable";

export function PartnerPortalBanners({
  rows,
}: {
  rows: BannerNameRow[];
}) {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
      <div className="mb-3">
        <h2 className="font-heading text-lg font-bold text-white">Seus banners</h2>
        <p className="text-xs text-emerald-100/50 mt-0.5">
          Leituras do QR e leads por nome do ponto. Locais arquivados ficam no
          histórico.
        </p>
      </div>
      <BannerNamesTable
        rows={rows}
        title="Nome · leituras · leads"
        emptyHint="Ainda sem leituras. Divulgue seu QR."
      />
    </section>
  );
}
