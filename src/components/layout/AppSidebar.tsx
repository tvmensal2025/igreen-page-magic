import { useEffect, useState } from "react";
import {
  BarChart3,
  LayoutGrid,
  UserCheck,
  Flame,
  Users,
  Database,
  ClipboardList,
  Handshake,
  Network,
  MessageSquare,
  Megaphone,
  Link as LinkIcon,
  FolderDown,
  ChevronLeft,
  LogOut,
  Mic,
  GraduationCap,
  Package,
  Settings,
  ChevronDown,
  MoreHorizontal,
  CalendarClock,
  Receipt,
} from "lucide-react";

export type AdminTabId =
  | "dashboard"
  | "crm"
  | "crm-clientes"
  | "conversao"
  | "clientes"
  | "financeiro"
  | "produtos"
  | "captacao"
  | "parceiros"
  | "rede"
  | "whatsapp"
  | "agendamentos"
  | "central-anuncios"
  | "links"
  | "materiais"
  | "audio-studio"
  | "academy";

interface NavItem {
  id: AdminTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
  href?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão Geral",
    items: [
      { id: "dashboard", label: "Painel", icon: BarChart3 },
      { id: "crm", label: "Clientes interessados", icon: LayoutGrid },
      { id: "crm-clientes", label: "Clientes ativos", icon: UserCheck },
      { id: "conversao", label: "Conversão", icon: Flame },
      { id: "clientes", label: "Base de clientes", icon: Database },
      { id: "financeiro", label: "Financeiro", icon: Receipt },
    ],
  },
  {
    label: "Gestão Comercial",
    items: [
      { id: "produtos", label: "Produtos & Vendas", icon: Package },
      { id: "captacao", label: "Captação", icon: ClipboardList },
      { id: "parceiros", label: "Parceiros", icon: Handshake },
      { id: "rede", label: "Rede", icon: Network },
      { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
      { id: "agendamentos", label: "Agendamentos", icon: CalendarClock },
    ],
  },
  {
    label: "Recursos",
    items: [
      { id: "central-anuncios", label: "Central de anúncios", icon: Megaphone },
      { id: "links", label: "Links", icon: LinkIcon },
      { id: "materiais", label: "Materiais", icon: FolderDown },
      { id: "audio-studio", label: "Estúdio de áudio", icon: Mic },
      { id: "academy", label: "Academy", icon: GraduationCap },
    ],
  },
];

/** Destinos principais no menu mobile — o restante fica em "Mais". */
const MOBILE_PRIMARY_IDS: AdminTabId[] = [
  "dashboard",
  "crm",
  "crm-clientes",
  "whatsapp",
  "produtos",
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const NAV_BY_ID = new Map(ALL_NAV_ITEMS.map((i) => [i.id, i]));
const MOBILE_PRIMARY_ITEMS: NavItem[] = MOBILE_PRIMARY_IDS.map((id) => NAV_BY_ID.get(id)).filter(
  (i): i is NavItem => !!i,
);
const MOBILE_MORE_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((i) => !MOBILE_PRIMARY_IDS.includes(i.id));

interface AppSidebarProps {
  activeTab: AdminTabId;
  onTabChange: (tab: AdminTabId) => void;
  onNavigate?: (href: string) => void;
  consultantName?: string;
  consultantLevel?: string;
  consultantPhoto?: string;
  onLogout?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsed?: boolean;
  onCollapse?: () => void;
  onOpenSettings?: () => void;
  /** Badge dinâmico por tab (ex.: contagem de boletos vencendo hoje). */
  badges?: Partial<Record<AdminTabId, number | string | undefined>>;
}


export function AppSidebar({
  activeTab,
  onTabChange,
  onNavigate,
  consultantName = "Consultor",
  consultantLevel = "iGreen Energy",
  consultantPhoto,
  onLogout,
  open = true,
  onOpenChange,
  collapsed = false,
  onCollapse,
  onOpenSettings,
  badges,
}: AppSidebarProps) {

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    if (MOBILE_MORE_ITEMS.some((i) => i.id === activeTab)) {
      setMobileMoreOpen(true);
    }
  }, [activeTab]);

  const handleItemClick = (item: NavItem) => {
    if (item.href && onNavigate) {
      onNavigate(item.href);
    } else {
      onTabChange(item.id);
    }
    onOpenChange?.(false);
    setMobileMoreOpen(false);
    // Auto-collapse on desktop after navigation
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      onCollapse?.();
    }
  };

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    const dynamicBadge = badges?.[item.id];
    const badge = dynamicBadge ?? item.badge;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleItemClick(item)}
        className={`pe-nav-item w-full text-left ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && badge !== undefined && badge !== 0 && badge !== "" && (
          <span className="pe-badge">{badge}</span>
        )}
      </button>
    );
  };


  const mobileMoreActive = MOBILE_MORE_ITEMS.some((i) => i.id === activeTab);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => onOpenChange?.(false)}
          className="lg:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
        />
      )}

      <aside
        className={`pe-sidebar ${collapsed ? "is-collapsed" : ""} fixed lg:sticky lg:top-0 left-0 top-0 z-40 h-[100dvh] shrink-0 flex flex-col shadow-2xl transition-all duration-300 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-[72px]" : "w-72"}`}
      >
        {/* Brand — foto do consultor */}
        <div className={`${collapsed ? "px-2 justify-center" : "px-5"} pt-6 pb-5 flex items-center gap-3 shrink-0`}>
          <div
            className="w-14 h-14 rounded-full p-[2px] shrink-0"
            style={{ background: "linear-gradient(135deg, var(--pe-accent-soft), var(--pe-accent), var(--pe-accent-deep))" }}
          >
            <div
              className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
              style={{ background: "var(--pe-emerald-strong)" }}
            >
              {consultantPhoto ? (
                <img src={consultantPhoto} alt={consultantName} className="w-full h-full object-cover" />
              ) : (
                <span className="pe-heading text-base font-bold" style={{ color: "var(--pe-accent)" }}>
                  {consultantName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="pe-heading text-base font-bold tracking-tight leading-tight truncate !text-white" style={{ color: "#ffffff" }}>{consultantName}</p>
                <p className="text-[9px] mt-1 uppercase tracking-[0.22em] truncate font-bold" style={{ color: "#ffffff" }}>{consultantLevel}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange?.(false)}
                className="lg:hidden p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                aria-label="Recolher"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Nav — desktop: grupos completos; mobile: 5 principais + Mais */}
        <nav className={`flex-1 ${collapsed ? "px-1" : "px-3"} pb-4 overflow-y-auto overflow-x-hidden`}>
          {/* Mobile condensado */}
          {!collapsed && (
            <div className="lg:hidden space-y-0.5">
              <div className="pe-sidebar-section">Principal</div>
              {MOBILE_PRIMARY_ITEMS.map(renderNavButton)}
              <button
                type="button"
                onClick={() => setMobileMoreOpen((v) => !v)}
                className={`pe-nav-item w-full text-left ${mobileMoreActive ? "is-active" : ""}`}
                aria-expanded={mobileMoreOpen}
                aria-label="Mais seções do painel"
              >
                <MoreHorizontal className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate flex-1">Mais</span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${mobileMoreOpen ? "rotate-180" : ""}`} />
              </button>
              {mobileMoreOpen && (
                <div className="space-y-0.5 pl-2 border-l border-white/10 ml-3">
                  {MOBILE_MORE_ITEMS.map(renderNavButton)}
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSettings();
                        onOpenChange?.(false);
                      }}
                      className="pe-nav-item w-full text-left"
                      aria-label="Configurações"
                    >
                      <Settings className="w-[18px] h-[18px] shrink-0" />
                      <span className="truncate">Configurações</span>
                    </button>
                  )}
                  {onLogout && (
                    <button
                      type="button"
                      onClick={onLogout}
                      className="pe-nav-item w-full text-left"
                      aria-label="Sair"
                    >
                      <LogOut className="w-[18px] h-[18px] shrink-0" />
                      <span className="truncate">Sair</span>
                    </button>
                  )}
                </div>
              )}

            </div>
          )}

          {/* Desktop (e sidebar colapsada no mobile usa ícones via grupos) */}
          <div className={collapsed ? "block" : "hidden lg:block"}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {!collapsed && <div className="pe-sidebar-section">{group.label}</div>}
              {collapsed && <div className="my-2 mx-3 h-px bg-white/5" />}
              <div className="space-y-0.5">
                {group.items.map((item) => renderNavButton(item))}
              </div>
            </div>
          ))}
          </div>

          {/* Conta — Configurações e Sair no mesmo padrão dos demais itens */}
          {(onOpenSettings || onLogout) && (
            <div>
              {!collapsed && <div className="pe-sidebar-section">Conta</div>}
              {collapsed && <div className="my-2 mx-3 h-px bg-white/5" />}
              <div className="space-y-0.5">
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSettings();
                      onOpenChange?.(false);
                    }}
                    className="pe-nav-item w-full text-left"
                    title={collapsed ? "Configurações" : undefined}
                    aria-label="Configurações"
                  >
                    <Settings className="w-[18px] h-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">Configurações</span>}
                  </button>
                )}
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="pe-nav-item w-full text-left"
                    title={collapsed ? "Sair" : undefined}
                    aria-label="Sair"
                  >
                    <LogOut className="w-[18px] h-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">Sair</span>}
                  </button>
                )}
              </div>
            </div>
          )}
        </nav>

      </aside>
    </>
  );
}

// Helper hook for mobile sidebar toggle state
export function useSidebarToggle() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}
