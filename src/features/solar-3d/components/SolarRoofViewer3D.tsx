import { Suspense, lazy } from "react";
import type { SolarPanelPosition, SolarRoofSegment } from "../lib/types";
import { SolarMap2D } from "./SolarMap2D";

const SolarRoofViewer3DInner = lazy(() =>
  import("./SolarRoofViewer3DInner").then((m) => ({ default: m.SolarRoofViewer3DInner })),
);

export function SolarRoofViewer3D(props: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
  className?: string;
}) {
  const can3d = typeof WebGLRenderingContext !== "undefined";
  if (!can3d) return <SolarMap2D {...props} />;
  return (
    <Suspense fallback={<SolarMap2D {...props} />}>
      <SolarRoofViewer3DInner {...props} />
    </Suspense>
  );
}
