import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SolarPanelPosition, SolarRoofSegment } from "../lib/types";

/**
 * Projeta lat/lng dos painéis em coordenadas locais (metros) relativas ao
 * centro do telhado, para um 3D fiel ao layout real. Fallback para grade.
 */
function toLocalMeters(
  panels: SolarPanelPosition[],
): Array<{ x: number; z: number; seg: number }> {
  const valid = panels.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  if (valid.length === 0) {
    return panels.map((p, i) => ({
      x: ((i % 6) - 2.5) * 0.55,
      z: (Math.floor(i / 6) - 1) * 0.45,
      seg: p.segmentIndex,
    }));
  }
  const lat0 = valid.reduce((s, p) => s + (p.lat as number), 0) / valid.length;
  const lng0 = valid.reduce((s, p) => s + (p.lng as number), 0) / valid.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return valid.map((p) => ({
    x: ((p.lng as number) - lng0) * mPerDegLng,
    z: ((p.lat as number) - lat0) * mPerDegLat,
    seg: p.segmentIndex,
  }));
}

function RoofScene({
  panelPositions,
  roofSegments,
}: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
}) {
  const locals = toLocalMeters(panelPositions);
  const scale = 1.6; // escala visual da cena
  const azimuth =
    panelPositions.find((p) => typeof p.azimuthDegrees === "number")?.azimuthDegrees ?? 0;
  const pitch = roofSegments[0]?.pitchDegrees ?? 18;
  const panelW = (panelPositions[0]?.widthM ?? 1.05) * scale;
  const panelH = (panelPositions[0]?.heightM ?? 1.88) * scale;

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 5]} intensity={1.3} />
      {/* grupo girado pelo azimute real do telhado */}
      <group rotation={[0, (-azimuth * Math.PI) / 180, 0]}>
        {/* base do telhado inclinada pelo pitch real */}
        <mesh rotation={[(-pitch * Math.PI) / 180, 0, 0]} position={[0, -0.05, 0]}>
          <boxGeometry args={[7, 0.1, 5]} />
          <meshStandardMaterial color="#7c4a21" />
        </mesh>
        {locals.map((p, i) => (
          <mesh
            key={i}
            position={[p.x * scale, 0.08, p.z * scale]}
            rotation={[(-pitch * Math.PI) / 180, 0, 0]}
          >
            <boxGeometry args={[panelW, 0.04, panelH]} />
            <meshStandardMaterial color="#1e3a5f" metalness={0.5} roughness={0.3} />
          </mesh>
        ))}
      </group>
      <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}

export function SolarRoofViewer3DInner({
  panelPositions,
  roofSegments,
  className = "",
}: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
  className?: string;
}) {
  return (
    <div className={`aspect-[4/3] rounded-xl overflow-hidden border ${className}`}>
      <Canvas frameloop="demand" camera={{ position: [4, 4, 6], fov: 45 }}>
        <RoofScene panelPositions={panelPositions} roofSegments={roofSegments} />
      </Canvas>
    </div>
  );
}
