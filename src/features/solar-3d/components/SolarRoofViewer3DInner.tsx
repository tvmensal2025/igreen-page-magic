import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SolarPanelPosition, SolarRoofSegment } from "../lib/types";

function RoofScene({
  panelPositions,
  roofSegments,
}: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
}) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} />
      {roofSegments.map((seg) => (
        <mesh
          key={seg.index}
          position={[(seg.index % 2) * 2.2 - 1, 0, Math.floor(seg.index / 2) * 1.8 - 0.5]}
          rotation={[-((seg.pitchDegrees ?? 20) * Math.PI) / 180, 0, 0]}
        >
          <boxGeometry args={[3.5, 0.08, 2.2]} />
          <meshStandardMaterial color="#b45309" />
        </mesh>
      ))}
      {panelPositions.map((p, i) => (
        <mesh
          key={p.index}
          position={[
            ((i % 6) - 2.5) * 0.55,
            0.12 + Math.floor(i / 6) * 0.02,
            (Math.floor(i / 6) - 1) * 0.45,
          ]}
        >
          <boxGeometry args={[0.5, 0.04, 0.9]} />
          <meshStandardMaterial color="#1e3a5f" metalness={0.4} roughness={0.3} />
        </mesh>
      ))}
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
      <Canvas frameloop="demand" camera={{ position: [4, 3, 5], fov: 45 }}>
        <RoofScene panelPositions={panelPositions} roofSegments={roofSegments} />
      </Canvas>
    </div>
  );
}
