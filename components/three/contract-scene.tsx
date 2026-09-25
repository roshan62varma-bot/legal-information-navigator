"use client";

import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useInView, useIsDark, usePrefersReducedMotion } from "@/lib/hooks";

/**
 * A contract being read: text lines on a sheet, highlighter strokes sweeping
 * across the risky lines, a redline through one clause, a green insertion,
 * and a brass seal. When `scanning` is on, a light bar sweeps the page.
 */

type Palette = { paper: string; back: string; ink: string; inkSoft: string; highlight: string; redline: string; seal: string; brass: string };

const LIGHT: Palette = { paper: "#fdfdfb", back: "#e7ebf2", ink: "#1b2a4a", inkSoft: "#8a94ab", highlight: "#f6d65c", redline: "#c0342a", seal: "#1c7a57", brass: "#b8893a" };
const DARK: Palette = { paper: "#eef1f6", back: "#2a3552", ink: "#1b2a4a", inkSoft: "#7d879d", highlight: "#f6d65c", redline: "#d8453a", seal: "#2f9b72", brass: "#c99a47" };

// Deterministic "text": line widths for a clause-like layout.
const LINES: { y: number; w: number; x: number; kind?: "heading" | "highlight" | "redline" | "insert" }[] = (() => {
  const out: { y: number; w: number; x: number; kind?: "heading" | "highlight" | "redline" | "insert" }[] = [];
  const widths = [0.92, 0.88, 0.95, 0.6, 0.9, 0.93, 0.85, 0.5, 0.94, 0.9, 0.78, 0.91, 0.87, 0.55, 0.93, 0.89, 0.72];
  let y = 1.02;
  out.push({ y, w: 0.55, x: 0, kind: "heading" });
  y -= 0.2;
  widths.forEach((w, i) => {
    if (i === 4 || i === 9 || i === 14) y -= 0.07; // paragraph gaps
    const kind = i === 5 || i === 6 || i === 15 ? "highlight" : i === 11 ? "redline" : i === 13 ? "insert" : undefined;
    out.push({ y, w, x: 0, kind });
    y -= 0.105;
  });
  return out;
})();

const SHEET_W = 2.0;
const SHEET_H = 2.6;
const TEXT_W = 1.56;

/** Grow a bar from its left edge: scale X and keep the left side pinned. */
function growFromLeft(m: THREE.Mesh | null, left: number, width: number, p: number) {
  if (!m) return;
  const s = Math.max(0.0001, p);
  m.scale.x = s;
  m.position.x = left + (width * s) / 2;
}

function Sheet({ palette, reduced, scanning }: { palette: Palette; reduced: boolean; scanning: boolean }) {
  const strokes = React.useRef<({ mesh: THREE.Mesh | null; left: number; width: number })[]>([]);
  const beam = React.useRef<THREE.Mesh>(null);
  const redRef = React.useRef<THREE.Mesh>(null);
  const insRef = React.useRef<THREE.Mesh>(null);
  const t0 = React.useRef<number | null>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (t0.current === null) t0.current = t;
    const cycle = 7.5;
    const local = reduced ? cycle * 0.7 : (t - t0.current + 0.4) % cycle;
    // Highlighter strokes draw one after another, then hold, then fade for the next loop.
    const fade = local > cycle - 0.8 ? 1 - (local - (cycle - 0.8)) / 0.8 : 1;
    strokes.current.forEach((st, i) => {
      if (!st?.mesh) return;
      const start = 0.3 + i * 0.55;
      const p = THREE.MathUtils.clamp((local - start) / 0.5, 0, 1);
      growFromLeft(st.mesh, st.left, st.width, 1 - Math.pow(1 - p, 3));
      (st.mesh.material as THREE.MeshStandardMaterial).opacity = 0.78 * fade;
    });
    const redLine = LINES.find((l) => l.kind === "redline")!;
    const insLine = LINES.find((l) => l.kind === "insert")!;
    growFromLeft(redRef.current, -TEXT_W / 2, TEXT_W * redLine.w, THREE.MathUtils.clamp((local - 2.2) / 0.45, 0, 1));
    if (redRef.current) (redRef.current.material as THREE.MeshStandardMaterial).opacity = fade;
    growFromLeft(insRef.current, -TEXT_W / 2, TEXT_W * insLine.w, THREE.MathUtils.clamp((local - 2.8) / 0.45, 0, 1));
    if (insRef.current) (insRef.current.material as THREE.MeshStandardMaterial).opacity = fade;
    if (beam.current) {
      const speed = scanning ? 1.4 : 0.35;
      const y = 1.3 - (((t * speed) % 1.3) / 1.3) * 2.6;
      beam.current.position.y = y;
      (beam.current.material as THREE.MeshBasicMaterial).opacity = scanning ? 0.35 : reduced ? 0 : 0.12;
    }
  });

  let strokeIndex = 0;
  const left = -TEXT_W / 2;

  return (
    <group>
      {/* paper */}
      <RoundedBox args={[SHEET_W, SHEET_H, 0.018]} radius={0.008} smoothness={2} castShadow receiveShadow>
        <meshStandardMaterial color={palette.paper} roughness={0.92} emissive={palette.paper} emissiveIntensity={0.28} />
      </RoundedBox>

      {/* text lines */}
      {LINES.map((l, i) => {
        const w = TEXT_W * l.w;
        const x = left + w / 2;
        const h = l.kind === "heading" ? 0.05 : 0.026;
        const color = l.kind === "heading" ? palette.ink : palette.inkSoft;
        const els: React.ReactNode[] = [
          <mesh key={`t${i}`} position={[x, l.y, 0.0105]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color={color} roughness={1} />
          </mesh>,
        ];
        if (l.kind === "highlight") {
          const idx = strokeIndex++;
          const sw = w + 0.04;
          els.push(
            <mesh
              key={`h${i}`}
              ref={(m) => {
                strokes.current[idx] = { mesh: m, left: left - 0.02, width: sw };
              }}
              position={[left - 0.02 + sw / 2, l.y, 0.0112]}
            >
              <planeGeometry args={[sw, 0.075]} />
              <meshStandardMaterial color={palette.highlight} transparent opacity={0.78} roughness={0.6} emissive={palette.highlight} emissiveIntensity={0.12} />
            </mesh>,
          );
        }
        if (l.kind === "redline") {
          els.push(
            <mesh key={`r${i}`} ref={redRef} position={[x, l.y, 0.0115]}>
              <planeGeometry args={[w, 0.012]} />
              <meshStandardMaterial color={palette.redline} transparent roughness={0.5} />
            </mesh>,
          );
        }
        if (l.kind === "insert") {
          els.push(
            <mesh key={`i${i}`} ref={insRef} position={[x, l.y - 0.03, 0.0115]}>
              <planeGeometry args={[w, 0.012]} />
              <meshStandardMaterial color={palette.seal} transparent roughness={0.5} />
            </mesh>,
          );
        }
        return els;
      })}

      {/* margin note beside the redlined clause */}
      <group position={[SHEET_W / 2 - 0.08, LINES[12].y, 0.012]}>
        <mesh>
          <circleGeometry args={[0.035, 24]} />
          <meshStandardMaterial color={palette.redline} />
        </mesh>
      </group>

      {/* scan beam */}
      <mesh ref={beam} position={[0, 0, 0.03]}>
        <planeGeometry args={[SHEET_W * 1.02, 0.05]} />
        <meshBasicMaterial color={palette.highlight} transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* brass seal */}
      <group position={[SHEET_W / 2 - 0.36, -SHEET_H / 2 + 0.36, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.045, 48]} />
          <meshStandardMaterial color={palette.brass} metalness={0.75} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0.026, 0]}>
          <torusGeometry args={[0.15, 0.012, 12, 48]} />
          <meshStandardMaterial color={palette.brass} metalness={0.85} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.05, 0.075, 6]} />
          <meshStandardMaterial color="#8a6424" metalness={0.8} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function Rig({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const group = React.useRef<THREE.Group>(null);
  const { pointer } = useThree();
  useFrame((_, dt) => {
    if (!group.current) return;
    const tx = reduced ? -0.12 : -0.18 + pointer.y * 0.18;
    const ty = reduced ? 0.32 : 0.34 + pointer.x * 0.35;
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, tx, 3, dt);
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, ty, 3, dt);
  });
  return <group ref={group}>{children}</group>;
}

function Scene({ scanning, compact }: { scanning: boolean; compact: boolean }) {
  const reduced = usePrefersReducedMotion();
  const dark = useIsDark();
  const palette = dark ? DARK : LIGHT;
  return (
    <>
      <ambientLight intensity={dark ? 0.55 : 0.75} />
      <directionalLight position={[3, 4, 5]} intensity={dark ? 1.6 : 1.9} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, -1, 2]} intensity={0.45} color={dark ? "#9fb4ff" : "#dfe6ff"} />
      <pointLight position={[1.2, -1.2, 1.4]} intensity={dark ? 3 : 2} color="#ffd98a" distance={4} />
      <Rig reduced={reduced}>
        <Float speed={reduced ? 0 : 1.4} rotationIntensity={reduced ? 0 : 0.18} floatIntensity={reduced ? 0 : 0.5}>
          {/* pages behind, fanned */}
          <group position={[0.16, 0.1, -0.22]} rotation={[0, 0, 0.07]}>
            <RoundedBox args={[SHEET_W, SHEET_H, 0.012]} radius={0.006} smoothness={2}>
              <meshStandardMaterial color={palette.back} roughness={0.95} />
            </RoundedBox>
          </group>
          <group position={[0.3, 0.2, -0.42]} rotation={[0, 0, 0.14]}>
            <RoundedBox args={[SHEET_W, SHEET_H, 0.012]} radius={0.006} smoothness={2}>
              <meshStandardMaterial color={palette.back} roughness={0.95} transparent opacity={0.8} />
            </RoundedBox>
          </group>
          <Sheet palette={palette} reduced={reduced} scanning={scanning} />
        </Float>
      </Rig>
      {!compact && <ContactShadows position={[0, -1.75, 0]} opacity={dark ? 0.55 : 0.35} scale={7} blur={2.6} far={3} />}
    </>
  );
}

export default function ContractScene({ scanning = false, compact = false, label }: { scanning?: boolean; compact?: boolean; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  // No GPU work while the scene is scrolled away or the tab is in the background;
  // with reduced motion the scene renders on demand only (a still frame).
  const visible = useInView(ref);
  const reduced = usePrefersReducedMotion();
  return (
    <div ref={ref} className="h-full w-full" role="img" aria-label={label}>
      <Canvas
        frameloop={!visible ? "never" : reduced ? "demand" : "always"}
        dpr={[1, 1.5]}
        shadows
        camera={{ position: [0, 0, compact ? 4.6 : 4.9], fov: 38 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <React.Suspense fallback={null}>
          <Scene scanning={scanning} compact={compact} />
        </React.Suspense>
      </Canvas>
    </div>
  );
}
