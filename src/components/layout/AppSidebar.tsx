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
      { id: "conversao", label: "Conversão", icon: Flame, href: "/admin/conversao" },
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
}: AppSidebarProps) {
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
        className={`pe-sidebar fixed lg:sticky lg:top-0 left-0 top-0 z-40 h-[100dvh] w-72 shrink-0 flex flex-col shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand */}
        <div className="px-6 pt-7 pb-6 flex items-center gap-3 shrink-0">
          <div className="w-11 h-11 rounded-2xl p-[2px]" style={{ background: "linear-gradient(135deg, #e6cf85, #c9a84c, #8a6f1f)" }}>
            <div className="w-full h-full rounded-2xl flex items-center justify-center" style={{ background: "#052e23" }}>
              <span className="pe-heading text-base font-bold" style={{ color: "#c9a84c" }}>iG</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="pe-heading text-xl font-bold text-white tracking-tight">iGreen</p>
            <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "rgba(201,168,76,0.7)" }}>Painel Elite</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="lg:hidden ml-auto p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
            aria-label="Recolher"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 pb-4 overflow-y-auto overflow-x-hidden">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="pe-sidebar-section">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.href && onNavigate) {
                          onNavigate(item.href);
                        } else {
                          onTabChange(item.id);
                          onOpenChange?.(false);
                        }
                      }}
                      className={`pe-nav-item w-full text-left ${isActive ? "is-active" : ""}`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span className="pe-badge">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer profile card */}
        <div className="p-4 shrink-0">
          <div
            className="rounded-2xl p-3 flex items-center gap-3 border"
            style={{
              background: "rgba(5, 46, 35, 0.65)",
              borderColor: "rgba(201,168,76,0.18)",
            }}
          >
            <div
              className="w-10 h-10 rounded-full overflow-hidden shrink-0 border-2"
              style={{ borderColor: "#c9a84c" }}
            >
              {consultantPhoto ? (
                <img src={consultantPhoto} alt={consultantName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm font-bold" style={{ background: "#052e23", color: "#c9a84c" }}>
                  {consultantName.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{consultantName}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: "#c9a84c" }}>
                {consultantLevel}
              </p>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-2 rounded-lg text-white/50 hover:text-[#c9a84c] hover:bg-white/5 transition-colors"
                aria-label="Sair"
                title="Sair"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// Helper hook for mobile sidebar toggle state
export function useSidebarToggle() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}
