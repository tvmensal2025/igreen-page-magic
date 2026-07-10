/**
 * Aba Admin > Ligação — Velip (PSTN) — módulo isolado do WhatsApp.
 * 6 sub-abas: Nova ligação · SMS · Bases · Histórico · Painel · Ajuda
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Phone, History, MessageSquare, Users, BarChart3, HelpCircle } from "lucide-react";
import { VoiceDialerPanel } from "@/components/admin/voz/VoiceDialerPanel";
import { VoiceCallHistoryPanel } from "@/components/admin/voz/VoiceCallHistoryPanel";
import { VoiceSmsPanel } from "@/components/admin/voz/VoiceSmsPanel";
import { VoiceContactBasesPanel } from "@/components/admin/voz/VoiceContactBasesPanel";
import { VoiceDashboardPanel } from "@/components/admin/voz/VoiceDashboardPanel";
import { VelipHealthBanner } from "@/components/admin/voz/VelipHealthBanner";
import type { VozCustomer } from "@/components/admin/voz/VozContactPickerDialog";

interface Props { consultantId: string; }

export function VozTab({ consultantId }: Props) {
  const [customers, setCustomers] = useState<VozCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, electricity_bill_value, status, devolutiva, registered_by_name")
        .eq("consultant_id", consultantId)
        .not("phone_whatsapp", "is", null)
        .order("updated_at", { ascending: false })
        .limit(3000);
      if (!alive) return;
      setCustomers((data as VozCustomer[]) ?? []);
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
    <div className="max-w-5xl mx-auto w-full space-y-4">
      <div className="pe-page-header">
        <div>
          <h2 className="pe-page-title">Ligação · SMS</h2>
          <p className="pe-page-sub">
            Discagem via Velip com áudio gravado ou voz sintetizada, SMS de follow-up e histórico auditável.
          </p>
        </div>
      </div>

      <VelipHealthBanner />

      <Tabs defaultValue="nova">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="nova" className="gap-2"><Phone className="h-4 w-4" /> Nova ligação</TabsTrigger>
          <TabsTrigger value="sms" className="gap-2"><MessageSquare className="h-4 w-4" /> SMS</TabsTrigger>
          <TabsTrigger value="bases" className="gap-2"><Users className="h-4 w-4" /> Bases</TabsTrigger>
          <TabsTrigger value="historico" className="gap-2"><History className="h-4 w-4" /> Histórico</TabsTrigger>
          <TabsTrigger value="painel" className="gap-2"><BarChart3 className="h-4 w-4" /> Painel</TabsTrigger>
        </TabsList>
        <TabsContent value="nova" className="mt-4">
          <VoiceDialerPanel consultantId={consultantId} customers={customers} />
        </TabsContent>
        <TabsContent value="sms" className="mt-4">
          <VoiceSmsPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="bases" className="mt-4">
          <VoiceContactBasesPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <VoiceCallHistoryPanel consultantId={consultantId} />
        </TabsContent>
        <TabsContent value="painel" className="mt-4">
          <VoiceDashboardPanel consultantId={consultantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
