import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";

type CrmDealRow = Tables<"crm_deals">;
type CrmDealUpdate = TablesUpdate<"crm_deals">;

const DEALS_PAGE = 400;

export function useKanbanDeals(consultantId: string, options?: { includeTests?: boolean }) {
  const includeTests = !!options?.includeTests;
  const [deals, setDeals] = useState<CrmDealRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const { toast } = useToast();

  const fetchDeals = useCallback(async (opts?: { append?: boolean }) => {
    const append = !!opts?.append;
    if (append) setLoadingMore(true);
    const from = append ? offsetRef.current : 0;
    const to = from + DEALS_PAGE - 1;

    const { data, error } = await supabase
      .from("crm_deals")
      .select("*, customers!inner(name, phone_whatsapp, customer_origin, lead_source, conversation_step, last_step_advanced_at, is_test_lead, is_sandbox)")
      .eq("consultant_id", consultantId)
      .or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null", { foreignTable: "customers" })
      .order("created_at", { ascending: false })
      .range(from, to);

    // Falha de rede/RLS NÃO pode esvaziar o Kanban em silêncio.
    if (error) {
      console.error("[useKanbanDeals] fetchDeals", error);
      toast({
        title: "Erro ao carregar o funil",
        description: error.message || "Tente novamente em instantes.",
        variant: "destructive",
      });
      if (append) setLoadingMore(false);
      return;
    }


    const enriched: any[] = (data || []).map((d: any) => ({
      ...d,
      customer_name: d.customers?.name || null,
      customer_origin: d.customers?.customer_origin || null,
      lead_source: d.customers?.lead_source || null,
      conversation_step: d.customers?.conversation_step || null,
      last_step_advanced_at: d.customers?.last_step_advanced_at || null,
      is_test_lead: d.customers?.is_test_lead || false,
      is_sandbox: d.customers?.is_sandbox || false,
    }));

    // Testes sintéticos só na primeira página (evita duplicar ao carregar mais)
    if (!append && includeTests) {
      const existingCustomerIds = new Set(enriched.map((d) => d.customer_id).filter(Boolean));
      const { data: testCustomers } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, customer_origin, conversation_step, last_step_advanced_at, is_test_lead, is_sandbox, created_at")
        .eq("consultant_id", consultantId)
        .or("is_test_lead.eq.true,is_sandbox.eq.true")
        .limit(200);
      for (const c of testCustomers || []) {
        if (existingCustomerIds.has(c.id)) continue;
        if (!["whatsapp_lead", "manual", null].includes((c as any).customer_origin)) continue;
        enriched.push({
          id: `synthetic:${c.id}`,
          __synthetic: true,
          customer_id: c.id,
          consultant_id: consultantId,
          remote_jid: c.phone_whatsapp ? `${c.phone_whatsapp}@s.whatsapp.net` : null,
          stage: "novo_lead",
          deal_origin: "whatsapp",
          notes: null,
          approved_at: null,
          rejected_at: null,
          rejection_reason: null,
          created_at: c.created_at,
          updated_at: c.created_at,
          customer_name: c.name,
          customer_origin: (c as any).customer_origin,
          conversation_step: c.conversation_step,
          last_step_advanced_at: c.last_step_advanced_at,
          is_test_lead: c.is_test_lead,
          is_sandbox: c.is_sandbox,
        } as any);
      }
    }

    const pageLen = (data || []).length;
    offsetRef.current = from + pageLen;
    setHasMore(pageLen >= DEALS_PAGE);
    setDeals((prev) => (append ? [...prev, ...(enriched as CrmDealRow[])] : (enriched as CrmDealRow[])));
    if (append) setLoadingMore(false);
  }, [consultantId, includeTests, toast]);

  const loadMore = useCallback(() => fetchDeals({ append: true }), [fetchDeals]);

  // Also try to resolve names by phone for deals without customer_id
  const resolveNames = useCallback(async (rawDeals: CrmDealRow[]) => {
    const needsLookup = rawDeals.filter((d) => !(d as any).customer_name && d.remote_jid && !(d as any).__synthetic);
    if (needsLookup.length === 0) return;
    const phones = Array.from(
      new Set(needsLookup.map((d) => d.remote_jid!.split("@")[0]).filter(Boolean)),
    );
    // Batches de 300 — `.in()` com lista grande estoura o tamanho da URL do PostgREST.
    const customers: any[] = [];
    for (let i = 0; i < phones.length; i += 300) {
      const { data, error } = await supabase
        .from("customers")
        .select("name, phone_whatsapp, conversation_step, last_step_advanced_at")
        .in("phone_whatsapp", phones.slice(i, i + 300));
      if (error) {
        console.error("[useKanbanDeals] resolveNames", error);
        break;
      }
      if (data?.length) customers.push(...data);
    }
    if (customers.length === 0) return;
    const phoneMap = new Map(customers.map((c: any) => [c.phone_whatsapp, c]));

    setDeals((prev) =>
      prev.map((d) => {
        if ((d as any).customer_name) return d;
        const phone = d.remote_jid?.split("@")[0];
        const c: any = phone ? phoneMap.get(phone) : null;
        return c ? { ...d, customer_name: c.name, conversation_step: c.conversation_step, last_step_advanced_at: c.last_step_advanced_at } as any : d;
      })
    );
  }, []);

  const moveDeal = async (dealId: string, stageKey: string, rejectionReason?: string) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return null;
    if ((deal as any).__synthetic) {
      toast({ title: "Reclassifique o lead antes de movê-lo", variant: "destructive" });
      return null;
    }

    const updateData: CrmDealUpdate = { stage: stageKey };
    // Lead CRM termina em "finalizando". Aprovado/Reprovado/30-120 dias
    // pertencem ao CRM Pós-Venda (customers.pos_venda_stage), populado pela
    // extensão iGreen — não tratamos esses casos aqui.
    if (rejectionReason) {
      (updateData as any).rejection_reason = rejectionReason;
    }

    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, ...updateData } : d)));

    const { error } = await supabase.from("crm_deals").update(updateData).eq("id", dealId);
    if (error) {
      toast({ title: "Erro ao mover deal", variant: "destructive" });
      fetchDeals();
      return null;
    }
    return { ...deal, ...updateData } as CrmDealRow;
  };

  const editDeal = async (dealId: string, phone: string, notes: string, originalJid: string | null) => {
    const newJid = phone.replace(/\D/g, "");
    const { error } = await supabase.from("crm_deals").update({
      remote_jid: newJid ? `${newJid}@s.whatsapp.net` : originalJid,
      notes: notes || null,
    }).eq("id", dealId);
    if (error) {
      toast({ title: "Erro ao editar deal", variant: "destructive" });
    } else {
      setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, remote_jid: newJid ? `${newJid}@s.whatsapp.net` : d.remote_jid, notes: notes || null } : d));
      toast({ title: "Deal atualizado!" });
    }
  };

  const deleteDeal = async (dealId: string) => {
    const deal = deals.find((d) => d.id === dealId);
    if ((deal as any)?.__synthetic) {
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
      return;
    }
    const { error } = await supabase.from("crm_deals").delete().eq("id", dealId);
    if (error) {
      toast({ title: "Erro ao excluir deal", variant: "destructive" });
    } else {
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
      toast({ title: "Deal excluído!" });
    }
  };

  const reclassifyAsReal = async (dealOrSynthetic: CrmDealRow) => {
    const customerId = dealOrSynthetic.customer_id;
    if (!customerId) {
      toast({ title: "Lead sem customer_id", variant: "destructive" });
      return;
    }
    const { error: upErr } = await supabase
      .from("customers")
      .update({ is_test_lead: false, is_sandbox: false })
      .eq("id", customerId);
    if (upErr) {
      toast({ title: "Erro ao reclassificar", description: upErr.message, variant: "destructive" });
      return;
    }
    if ((dealOrSynthetic as any).__synthetic) {
      const { error: insErr } = await supabase.from("crm_deals").insert({
        consultant_id: consultantId,
        customer_id: customerId,
        remote_jid: dealOrSynthetic.remote_jid,
        stage: "novo_lead",
        deal_origin: "whatsapp",
      });
      if (insErr && !/duplicate|unique/i.test(insErr.message)) {
        toast({ title: "Erro ao criar deal", description: insErr.message, variant: "destructive" });
        return;
      }
    }
    toast({ title: "✅ Lead reclassificado como real" });
    fetchDeals();
  };

  return { deals, setDeals, fetchDeals, loadMore, hasMore, loadingMore, resolveNames, moveDeal, editDeal, deleteDeal, reclassifyAsReal };
}
