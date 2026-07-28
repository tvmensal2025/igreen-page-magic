/**
 * Ícones inline em SVG.
 *
 * Por que não `lucide-react`: cada ícone importado entra no bundle da página.
 * Aqui são 13 ícones, todos com o mesmo grid de 24px e o mesmo traço — desenhar
 * os paths direto custa ~2 KB no total e zero import extra.
 *
 * Todos decorativos: quem chama passa `aria-hidden` no wrapper, porque o
 * significado já está no título ao lado.
 */

const base = {
  viewBox: "0 0 24 24",
  width: 19,
  height: 19,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<string, JSX.Element> = {
  // ── Problemas ──
  "trending-up": (
    <>
      <path d="M22 7 13.5 15.5l-4-4L2 19" />
      <path d="M16 7h6v6" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 2h12M6 22h12" />
      <path d="M8 2v4a4 4 0 0 0 4 4 4 4 0 0 0 4-4V2" />
      <path d="M8 22v-4a4 4 0 0 1 4-4 4 4 0 0 1 4 4v4" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5" />
      <circle cx="16.5" cy="13" r="1.2" />
    </>
  ),
  "file-question": (
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M10 12.5a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3" />
      <path d="M11.8 18h.01" />
    </>
  ),

  // ── Benefícios ──
  percent: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  store: (
    <>
      <path d="M3 9V6.5L5 3h14l2 3.5V9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M10 21v-5h4v5" />
    </>
  ),
  "zap-off": (
    <>
      <path d="M11 2 4.5 13H10l-1 9 4.5-7.5" />
      <path d="M13.5 8.5 20 2h-6" />
      <path d="M3 3l18 18" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="10.5" width="17" height="11" rx="2.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 8.6-1.8" />
      <path d="M12 15v2.5" />
    </>
  ),
  smartphone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  "shield-check": (
    <>
      <path d="M12 22s8-3.5 8-10V5.5L12 2 4 5.5V12c0 6.5 8 10 8 10z" />
      <path d="m8.8 11.8 2.2 2.2 4.2-4.2" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8.5 14-1.5 8 5-3 5 3-1.5-8" />
    </>
  ),
  leaf: (
    <>
      <path d="M4 20c0-8 6-14 16-14 0 10-6 15-13 15H4z" />
      <path d="M4 20c4-6 8-9 13-11" />
    </>
  ),

  // ── Produtos Conexão (telecom, seguros, placas, livre, club, expansão) ──
  zap: <path d="M13 2 4.5 13H10l-1 9 8.5-11H12z" />,
  phone: (
    <path d="M15.5 21a13.5 13.5 0 0 1-12.5-12.5A2.5 2.5 0 0 1 5.5 6h1.9a1.5 1.5 0 0 1 1.47 1.2l.5 2.4a1.5 1.5 0 0 1-.65 1.55l-1 .68a10.5 10.5 0 0 0 4.55 4.55l.68-1a1.5 1.5 0 0 1 1.55-.65l2.4.5A1.5 1.5 0 0 1 18 16.6v1.9A2.5 2.5 0 0 1 15.5 21z" />
  ),
  message: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-4.6A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z" />
      <path d="M9 11h6M9 14.5h3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  wrench: (
    <path d="M14.5 6.5a3.8 3.8 0 0 1 5 5l-2-2-3 3-3-3 3-3z M11.5 12.5 5 19a2.1 2.1 0 0 0 3 3l6.5-6.5" />
  ),
  car: (
    <>
      <path d="M4 15.5h16v-3l-1.8-4.2A2 2 0 0 0 16.4 7H7.6a2 2 0 0 0-1.8 1.3L4 12.5z" />
      <path d="M4 15.5V19h3v-3.5M17 15.5V19h3v-3.5" />
      <path d="M7.5 12.5h9" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
      <path d="M15 10h3a2 2 0 0 1 2 2v9" />
      <path d="M8 7h3M8 11h3M8 15h3M3 21h18" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9" />
      <path d="M18 20a6.4 6.4 0 0 0-1.6-4.2" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg {...base} aria-hidden="true" focusable="false">
      {path}
    </svg>
  );
}

export const ProblemIcon = Icon;
export const BenefitIcon = Icon;
export default Icon;
