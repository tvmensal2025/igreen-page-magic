import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  type: "new_lead" | "status_change" | "devolutiva" | "new_customer" | "deal_moved" | "page_view" | "proposal_update";
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  meta?: Record<string, string>;
}

const STORAGE_KEY = "igreen_notifications";
const MAX_NOTIFICATIONS = 50;

function loadFromStorage(): Notification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToStorage(notifications: Notification[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS))); } catch {}
}

export function useNotifications(consultantId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>(() => loadFromStorage());
  const [unreadCount, setUnreadCount] = useState(() => loadFromStorage().filter((n) => !n.read).length);
  const prevCustomersRef = useRef<Map<string, string>>(new Map());
  const initialLoadDone = useRef(false);

  // Persist to localStorage on every change
  useEffect(() => { saveToStorage(notifications); }, [notifications]);

  useEffect(() => {
    if (!consultantId) return;
    (async () => {
      const { data } = await supabase.from("customers").select("id, status, name").eq("consultant_id", consultantId);
      if (data) {
        const map = new Map<string, string>();
        data.forEach((c) => map.set(c.id, c.status));
        prevCustomersRef.current = map;
      }
      initialLoadDone.current = true;
    })();
  }, [consultantId]);

  const addNotification = useCallback((n: Omit<Notification, "id" | "timestamp" | "read">) => {
    const notification: Notification = { ...n, id: crypto.randomUUID(), timestamp: new Date().toISOString(), read: false };
    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    setUnreadCount((prev) => prev + 1);
  }, []);

  // Single multiplexed Realtime channel — combines 4 listeners into 1 WS connection
  useEffect(() => {
    if (!consultantId) return;
    const channel = supabase
      .channel(`notif-${consultantId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_deals", filter: `consultant_id=eq.${consultantId}` }, (payload) => {
        const deal = payload.new as any;
        const phone = deal.remote_jid?.split("@")[0] || "Desconhecido";
        addNotification({ type: "new_lead", title: "🟢 Novo lead no CRM", description: `Lead ${phone} adicionado na etapa "${deal.stage}"`, meta: { dealId: deal.id, phone } });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crm_deals", filter: `consultant_id=eq.${consultantId}` }, (payload) => {
        const oldDeal = payload.old as any;
        const newDeal = payload.new as any;
        if (oldDeal.stage === newDeal.stage) return;
        const phone = newDeal.remote_jid?.split("@")[0] || "Lead";
        addNotification({ type: "deal_moved", title: "📋 Deal movido", description: `${phone}: ${oldDeal.stage} → ${newDeal.stage}`, meta: { dealId: newDeal.id, from: oldDeal.stage, to: newDeal.stage } });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers", filter: `consultant_id=eq.${consultantId}` }, (payload) => {
        const customer = payload.new as any;
        const name = customer.name || customer.phone_whatsapp || "Novo cliente";
        prevCustomersRef.current.set(customer.id, customer.status);
        addNotification({ type: "new_customer", title: "👤 Novo cliente cadastrado", description: `${name} foi adicionado à sua base`, meta: { customerId: customer.id } });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers", filter: `consultant_id=eq.${consultantId}` }, (payload) => {
        if (!initialLoadDone.current) return;
        const customer = payload.new as any;
        const oldStatus = prevCustomersRef.current.get(customer.id);
        const newStatus = customer.status;
        if (oldStatus === newStatus) return;
        prevCustomersRef.current.set(customer.id, newStatus);
        const name = customer.name || customer.phone_whatsapp || "Cliente";

        if (newStatus === "approved") addNotification({ type: "status_change", title: "✅ Cliente aprovado", description: `${name} foi aprovado pela iGreen`, meta: { customerId: customer.id, status: "approved" } });
        else if (newStatus === "rejected") addNotification({ type: "status_change", title: "❌ Cliente reprovado", description: `${name} foi reprovado`, meta: { customerId: customer.id, status: "rejected" } });
        else if (newStatus === "devolutiva") addNotification({ type: "devolutiva", title: "⚠️ Devolutiva recebida", description: `${name} — ${customer.devolutiva || "Verificar pendência"}`, meta: { customerId: customer.id, status: "devolutiva" } });
        else if (newStatus === "awaiting_signature") addNotification({ type: "status_change", title: "✍️ Falta assinatura", description: `${name} precisa assinar o contrato`, meta: { customerId: customer.id, status: "awaiting_signature" } });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "proposals", filter: `consultant_id=eq.${consultantId}` }, (payload) => {
        const oldProposal = payload.old as any;
        const newProposal = payload.new as any;
        // Só notifica quando o destinatário responde (aceite/recusa/contraproposta).
        if (oldProposal.status === newProposal.status) return;
        if (newProposal.status === "accepted") {
          addNotification({ type: "proposal_update", title: "🎉 Proposta aceita!", description: "Um cliente aceitou sua proposta. A venda foi criada em captura.", meta: { proposalId: newProposal.id, status: "accepted" } });
        } else if (newProposal.status === "countered") {
          addNotification({ type: "proposal_update", title: "💬 Contraproposta recebida", description: "Um cliente enviou uma contraproposta. Abra para responder.", meta: { proposalId: newProposal.id, status: "countered" } });
        } else if (newProposal.status === "rejected") {
          addNotification({ type: "proposal_update", title: "📋 Proposta recusada", description: "Um cliente recusou sua proposta.", meta: { proposalId: newProposal.id, status: "rejected" } });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [consultantId, addNotification]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markAllRead, markRead, clearAll };
}
