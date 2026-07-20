/**
 * Aba Admin > Ligação — Velip (PSTN) — módulo isolado do WhatsApp.
 * Sub-abas: Nova ligação · SMS · Bases · Não Perturbe · Histórico · Painel · Ajuda
 *
 * Contatos: busca leads e carteira em queries separadas para o PostgREST
 * (max ~1000) não esconder whatsapp_lead atrás de igreen_sync recentes.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Phone, History, MessageSquare, Users, BarChart3, HelpCircle, ShieldBan, RefreshCw, BookOpen } from "lucide-react";
import { VoiceDialerPanel } from "@/components/admin/voz/VoiceDialerPanel";
import { VoiceCallHistoryPanel } from "@/components/admin/voz/VoiceCallHistoryPanel";
import { VoiceSmsPanel } from "@/components/admin/voz/VoiceSmsPanel";
import { VoiceContactBasesPanel } from "@/components/admin/voz/VoiceContactBasesPanel";
import { VoiceDashboardPanel } from "@/components/admin/voz/VoiceDashboardPanel";
import { VoiceDncPanel } from "@/components/admin/voz/VoiceDncPanel";
import { VoiceHelpPanel } from "@/components/admin/voz/VoiceHelpPanel";
import { VoiceCycleKitPanel } from "@/components/admin/voz/VoiceCycleKitPanel";
import { MultichannelTextsPanel } from "@/components/admin/voz/MultichannelTextsPanel";
import { VelipHealthBanner } from "@/components/admin/voz/VelipHealthBanner";
import type { VozCustomer } from "@/components/admin/voz/VozContactPickerDialog";

interface Props {
  consultantId: string;
  /** Abre o chat interno do WhatsApp (aba Conversas) — mesmo fluxo do CRM. */
  onOpenChat?: (phone: string) => void;
}

const CUSTOMER_SELECT =
  "id, name, phone_whatsapp, electricity_bill_value, status, devolutiva, andamento_igreen, conversation_step, pos_venda_stage, bot_paused, registered_by_name, last_bot_interaction_at, created_at, updated_at, customer_origin";

function mergeById(primary: VozCustomer[], secondary: VozCustomer[]): VozCustomer[] {
  const map = new Map<string, VozCustomer>();
  for (const c of primary) map.set(c.id, c);
  for (const c of secondary) {
    if (!map.has(c.id)) map.set(c.id, c);
  }
  return Array.from(map.values());
}

export function VozTab({ consultantId, onOpenChat }: Props) {
  const [customers, setCustomers] = useState<VozCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("sub");
      if (fromUrl) return fromUrl;
      return sessionStorage.getItem("igreen-voz-subtab") || "nova";
    } catch {
      return "nova";
    }
  });

  useEffect(() => {
    const onSub = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sub?: string } | undefined;
      if (detail?.sub) setSubTab(detail.sub);
    };
    window.addEventListener("igreen-voz-subtab", onSub);
    // Deep-link /admin?tab=voz&sub=textos (Motor → Grupo B)
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("sub");
      if (fromUrl) setSubTab(fromUrl);
    } catch { /* noop */ }
    return () => window.removeEventListener("igreen-voz-subtab", onSub);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("igreen-voz-subtab", subTab);
    } catch {
      /* noop */
    }
  }, [subTab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // Duas queries com .in() (evita .or() que às vezes zera o resultado no client).
      const leadsQ = supabase
        .from("customers")
        .select(CUSTOMER_SELECT)
        .eq("consultant_id", consultantId)
        .in("customer_origin", ["whatsapp_lead", "manual"])
        .not("phone_whatsapp", "is", null)
        .order("updated_at", { ascending: false })
        .limit(2000);

      const walletQ = supabase
        .from("customers")
        .select(CUSTOMER_SELECT)
        .eq("consultant_id", consultantId)
        .in("customer_origin", ["igreen_sync", "igreen_extension"])
        .not("phone_whatsapp", "is", null)
        .order("updated_at", { ascending: false })
        .limit(2000);

      const [leadsRes, walletRes] = await Promise.all([leadsQ, walletQ]);
      if (!alive) return;

      if (leadsRes.error) console.error("[VozTab] leads fetch", leadsRes.error);
      if (walletRes.error) console.error("[VozTab] wallet fetch", walletRes.error);

      const leads = (leadsRes.data as VozCustomer[]) ?? [];
      const wallet = (walletRes.data as VozCustomer[]) ?? [];
      setCustomers(mergeById(leads, wallet));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [consultantId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--pe-emerald)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-4">
      <div className="pe-page-header">
        <div>
          <h2 className="pe-page-title">Ligação · SMS</h2>
          <p className="pe-page-sub">
            Textos do plano multicanal em <strong>Textos Multicanal</strong>. Kit diário em{" "}
            <strong>Programação do ciclo</strong>. Status do envio automático fica no Multicanal e na Pizza A·B·C.
          </p>
        </div>
      </div>

      <VelipHealthBanner />

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="nova" className="gap-2"><Phone className="h-4 w-4" /> Nova ligação</TabsTrigger>
          <TabsTrigger value="sms" className="gap-2"><MessageSquare className="h-4 w-4" /> SMS</TabsTrigger>
          <TabsTrigger value="bases" className="gap-2"><Users className="h-4 w-4" /> Bases</TabsTrigger>
          <TabsTrigger value="dnc" className="gap-2"><ShieldBan className="h-4 w-4" /> Não Perturbe</TabsTrigger>
          <TabsTrigger value="kit" className="gap-2"><RefreshCw className="h-4 w-4" /> Programação do ciclo</TabsTrigger>
          <TabsTrigger value="textos" className="gap-2"><BookOpen className="h-4 w-4" /> Textos Multicanal</TabsTrigger>
          <TabsTrigger value="historico" className="gap-2"><History className="h-4 w-4" /> Histórico</TabsTrigger>
          <TabsTrigger value="painel" className="gap-2"><BarChart3 className="h-4 w-4" /> Painel</TabsTrigger>
          <TabsTrigger value="ajuda" className="gap-2"><HelpCircle className="h-4 w-4" /> Ajuda</TabsTrigger>
        </TabsList>
        <TabsContent value="nova" className="mt-4">
          <VoiceDialerPanel consultantId={consultantId} customers={customers} />
        </TabsContent>
        <TabsContent value="sms" className="mt-4">
          <VoiceSmsPanel consultantId={consultantId} customers={customers} />
        </TabsContent>
        <TabsContent value="bases" className="mt-4">
          <VoiceContactBasesPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="dnc" className="mt-4">
          <VoiceDncPanel consultantId={consultantId} customers={customers} onOpenChat={onOpenChat} />
        </TabsContent>
        <TabsContent value="kit" className="mt-4">
          <VoiceCycleKitPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="textos" className="mt-4">
          <MultichannelTextsPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <VoiceCallHistoryPanel consultantId={consultantId} customers={customers} onOpenChat={onOpenChat} />
        </TabsContent>
        <TabsContent value="painel" className="mt-4">
          <VoiceDashboardPanel consultantId={consultantId} customers={customers} />
        </TabsContent>
        <TabsContent value="ajuda" className="mt-4">
          <VoiceHelpPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
