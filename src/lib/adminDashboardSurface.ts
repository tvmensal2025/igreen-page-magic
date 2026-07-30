/** Aba ativa do painel admin (Admin.tsx). Usado por FABs flutuantes. */
export const ADMIN_ACTIVE_TAB_KEY = "igreen_admin_active_tab_v1";
export const ADMIN_TAB_CHANGED_EVENT = "igreen-admin-tab-changed";

/** True só na home do Dashboard (/admin + aba dashboard). */
export function isAdminDashboardSurface(pathname: string): boolean {
  if (pathname !== "/admin") return false;
  try {
    const tab = window.localStorage.getItem(ADMIN_ACTIVE_TAB_KEY);
    return !tab || tab === "dashboard";
  } catch {
    return true;
  }
}

export function notifyAdminTabChanged(tab: string): void {
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_TAB_CHANGED_EVENT, { detail: { tab } }));
  } catch {
    /* ignore */
  }
}
