import { useState } from "react";
import {
  BarChart3,
  LayoutGrid,
  Flame,
  Users,
  ClipboardList,
  Handshake,
  Network,
  MessageSquare,
  Megaphone,
  Link as LinkIcon,
  FolderDown,
  ChevronLeft,
  LogOut,
} from "lucide-react";

export type AdminTabId =
  | "dashboard"
  | "crm"
  | "conversao"
  | "clientes"
  | "captacao"
  | "parceiros"
  | "rede"
  | "whatsapp"
  | "central-anuncios"
  | "links"
  | "materiais";

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
      { id: "dashboard", label: "Dashboard", icon: BarChart3 },
      { id: "crm", label: "CRM", icon: LayoutGrid },
      { id: "conversao", label: "Conversão", icon: Flame },
      { id: "clientes", label: "Clientes", icon: Users },
    ],
  },
  {
    label: "Gestão Comercial",
    items: [
      { id: "captacao", label: "Captação", icon: ClipboardList },
      { id: "parceiros", label: "Parceiros", icon: Handshake },
      { id: "rede", label: "Rede", icon: Network },
      { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
    ],
  },
  {
    label: "Recursos",
    items: [
      { id: "central-anuncios", label: "Central de Anúncios", icon: Megaphone },
      { id: "links", label: "Links", icon: LinkIcon },
      { id: "materiais", label: "Materiais", icon: FolderDown },
    ],
  },
];

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
}: AppSidebarProps) {
  const handleItemClick = (item: NavItem) => {
    if (item.href && onNavigate) {
      onNavigate(item.href);
    } else {
      onTabChange(item.id);
    }
    onOpenChange?.(false);
    // Auto-collapse on desktop after navigation
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      onCollapse?.();
    }
  };

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
                <p className="pe-heading text-base font-bold tracking-tight leading-tight truncate text-slate-50">{consultantName}</p>
                <p className="text-[9px] mt-1 uppercase tracking-[0.22em] truncate text-lime-200">{consultantLevel}</p>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Sair"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
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

        {/* Nav */}
        <nav className={`flex-1 ${collapsed ? "px-1" : "px-3"} pb-4 overflow-y-auto overflow-x-hidden`}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {!collapsed && <div className="pe-sidebar-section">{group.label}</div>}
              {collapsed && <div className="my-2 mx-3 h-px bg-white/5" />}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
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
                      {!collapsed && item.badge !== undefined && (
                        <span className="pe-badge">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {collapsed && onLogout && (
          <div className="p-2 shrink-0 flex justify-center">
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// Helper hook for mobile sidebar toggle state
export function useSidebarToggle() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}
