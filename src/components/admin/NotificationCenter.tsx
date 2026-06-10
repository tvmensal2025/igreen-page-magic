import { useState, useRef, useEffect } from "react";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Notification } from "@/hooks/useNotifications";

interface NotificationCenterProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onClearAll: () => void;
  onAction?: (notification: Notification) => void;
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function typeColor(type: Notification["type"]): string {
  switch (type) {
    case "new_lead": return "bg-primary/100";
    case "status_change": return "bg-info/100";
    case "devolutiva": return "bg-warning/100";
    case "new_customer": return "bg-primary/100";
    case "deal_moved": return "bg-info/100";
    case "page_view": return "bg-gray-500";
    default: return "bg-gray-500";
  }
}

export function NotificationCenter({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  onClearAll,
  onAction,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive/100 px-1 text-[9px] font-bold text-white animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] sm:w-[380px] rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Notificações</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[9px] bg-destructive/10 text-destructive border-destructive/20">
                  {unreadCount} nova{unreadCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={onMarkAllRead}
                >
                  <CheckCheck className="h-3 w-3" /> Ler tudo
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                  onClick={onClearAll}
                >
                  <Trash2 className="h-3 w-3" /> Limpar
                </Button>
              )}
            </div>
          </div>

          {/* Notification list */}
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Bell className="h-8 w-8 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground">Nenhuma notificação</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="divide-y divide-border/50">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    className={`w-full text-left px-4 py-3 hover:bg-secondary/30 transition-colors flex items-start gap-3 ${
                      !n.read ? "bg-primary/5" : ""
                    }`}
                    onClick={() => {
                      onMarkRead(n.id);
                      onAction?.(n);
                    }}
                  >
                    {/* Dot indicator */}
                    <div className="mt-1.5 shrink-0">
                      <div className={`h-2 w-2 rounded-full ${!n.read ? typeColor(n.type) : "bg-muted-foreground/20"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-tight ${!n.read ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {n.description}
                      </p>
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 shrink-0 mt-0.5">
                      {timeAgo(n.timestamp)}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
