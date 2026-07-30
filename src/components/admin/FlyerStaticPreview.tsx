import { QRCodeSVG } from "qrcode.react";
import type { RefObject } from "react";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import {
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import {
  FLYER_PREVIEW_MAX_H,
  FLYER_PREVIEW_W,
  FLYER_QR_BORDER_PX,
  FLYER_QR_QUIET_PX,
  FLYER_TEMPLATES,
  type FlyerFormatId,
  flyerFooterLeft,
  flyerFooterRight,
} from "@/components/admin/flyerTemplates";
import { formatFlyerPhoneDisplay } from "@/components/admin/flyerPhoneDisplay";
import { useIsMobile } from "@/hooks/use-mobile";

type Props = {
  format: FlyerFormatId;
  liveUrl: string;
  consultantName: string;
  consultantIgreenId?: string;
  consultantPhone?: string;
  /** Ref opcional no wrapper do SVG (export PNG/PDF). */
  qrSvgRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  previewMaxW?: number;
  previewMaxH?: number;
};

/**
 * Preview HTML 1:1 com impressão (arte + QR % largura + rodapé clamp).
 * Usado por portal público, live modal parceiro e download consultor.
 */
export function FlyerStaticPreview({
  format,
  liveUrl,
  consultantName,
  consultantIgreenId = "",
  consultantPhone = "",
  qrSvgRef,
  className,
  previewMaxW,
  previewMaxH,
}: Props) {
  const isMobile = useIsMobile();
  const template = FLYER_TEMPLATES[format];
  const maxW = previewMaxW ?? (isMobile ? 240 : FLYER_PREVIEW_W);
  const maxH = previewMaxH ?? (isMobile ? 240 : FLYER_PREVIEW_MAX_H);
  const { width: previewW, height: previewH } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    maxW,
    maxH,
  );

  const qrCorePx = (template.qrSize / 100) * previewW;
  const qrFramePx =
    qrCorePx + FLYER_QR_QUIET_PX * 2 + FLYER_QR_BORDER_PX * 2;

  const footerLeft = flyerFooterLeft(consultantName, consultantIgreenId);
  const footerRight = flyerFooterRight(
    formatFlyerPhoneDisplay(consultantPhone),
  );
  const { bandTop: footerTop, bandHeight: footerHPx } = clampFooterBand(
    previewH,
    template.footerY,
    template.footerH,
  );
  const footerFont = previewFooterFontSize(
    previewW,
    footerHPx,
    footerLeft,
    footerRight,
    "700",
  );

  return (
    <div
      className={
        className ??
        "relative max-w-full shrink-0 overflow-hidden rounded-xl border bg-primary shadow-sm"
      }
      style={{ width: previewW, height: previewH }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${template.bg})` }}
      />
      {liveUrl ? (
        <div
          ref={qrSvgRef}
          className="absolute z-[2] box-border select-none border border-neutral-900 bg-white"
          style={{
            left: `calc(${template.qrX}% - ${qrFramePx / 2}px)`,
            top: `calc(${template.qrY}% - ${qrFramePx / 2}px)`,
            width: qrFramePx,
            height: qrFramePx,
            padding: FLYER_QR_QUIET_PX,
            borderWidth: FLYER_QR_BORDER_PX,
          }}
        >
          <QRCodeSVG
            value={liveUrl}
            size={qrCorePx}
            level="M"
            includeMargin={false}
            style={{ display: "block" }}
          />
        </div>
      ) : null}
      <div
        className="absolute left-0 right-0 z-[2] flex items-center justify-between overflow-hidden whitespace-nowrap bg-primary/95 px-2 py-0 leading-none select-none"
        style={{
          top: footerTop,
          height: footerHPx,
          minHeight: footerHPx,
          maxHeight: footerHPx,
          fontSize: footerFont,
          color: "#fff200",
          fontWeight: 700,
        }}
      >
        <span>{footerLeft}</span>
        <span className="shrink-0 pl-1">{footerRight}</span>
      </div>
    </div>
  );
}
