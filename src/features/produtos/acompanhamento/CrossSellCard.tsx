// =============================================================================
// Cross-sell iGreen — oportunidades manuais (sem disparo automático)
// =============================================================================
// Lista clientes de energia (customers) do consultor que NÃO aparecem na
// carteira Telecom nem Seguros (via `igreen_telecom_customers` / `igreen_seguros_customers`).
// O consultor decide se envia — nada é disparado automático.
// Mensagem e filtros vêm de consultant_message_templates.cross_sell_hint.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Smartphone,
  ShieldCheck,
  MessageCircle,
  Copy,
  Check,
  Settings2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useTelecomCustomers, useSegurosCustomers } from "./multiprodutoHooks";
import { CrossSellConfigDialog } from "./CrossSellConfigDialog";
import {
  CROSS_SELL_STAGES,
  CROSS_SELL_TEMPLATE_KEY,
  DEFAULT_CROSS_SELL_MESSAGE,
  DEFAULT_CROSS_SELL_PREFS,
  applyCrossSellTemplate,
  buildPhoneKeySet,
  hasProductMatch,
  normName,
  parseCrossSellVariables,
  produtoLabelForGaps,
  type CrossSellPrefs,
  type CrossSellStage,
} from "./crossSellConfig";

interface EnergyLead {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  pos_venda_stage: string | null;
}

interface CrossSellConfig {
  message: string;
  prefs: CrossSellPrefs;
}

function useCrossSellConfig(consultantId?: string) {
  return useQuery({
    queryKey: ["cross-sell-config", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<CrossSellConfig> => {
      const { data, error } = await supabase
        .from("consultant_message_templates")
        .select("consultant_id, text_content, variables")
        .eq("template_key", CROSS_SELL_TEMPLATE_KEY)
        .or(`consultant_id.eq.${consultantId!},consultant_id.is.null`);
      if (error) throw error;
      const rows = data || [];
      const mine = rows.find((r) => r.consultant_id === consultantId);
      const global = rows.find((r) => r.consultant_id == null);
      const chosen = mine || global;
      return {
        message: chosen?.text_content?.trim() || DEFAULT_CROSS_SELL_MESSAGE,
        prefs: parseCrossSellVariables(chosen?.variables),
      };
    },
    staleTime: 30_000,
  });
}

function useEnergyCustomers(consultantId?: string) {
  return useQuery({
    queryKey: ["cross-sell-energy", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<EnergyLead[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, address_city, address_state, pos_venda_stage")
        .eq("consultant_id", consultantId!)
        .in("pos_venda_stage", [...CROSS_SELL_STAGES])
        .not("phone_whatsapp", "is", null)
        .limit(500);
      if (error) throw error;
      return (data || []).map((r) => ({
        id: (r as { id: string }).id,
        full_name: (r as { name: string | null }).name ?? null,
        phone: (r as { phone_whatsapp: string | null }).phone_whatsapp ?? null,
        city: (r as { address_city: string | null }).address_city ?? null,
        state: (r as { address_state: string | null }).address_state ?? null,
        pos_venda_stage: (r as { pos_venda_stage: string | null }).pos_venda_stage ?? null,
      }));
    },
    staleTime: 60_000,
  });
}

function normPhoneDigits(p?: string | null): string {
  return String(p || "").replace(/\D/g, "");
}

export function CrossSellCard({ consultantId }: { consultantId?: string }) {
  const queryClient = useQueryClient();
  const { data: energy = [], isLoading: loadingE } = useEnergyCustomers(consultantId);
  const { data: telecom = [] } = useTelecomCustomers(consultantId);
  const { data: seguros = [] } = useSegurosCustomers(consultantId);
  const { data: config } = useCrossSellConfig(consultantId);
  const [copied, setCopied] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [open, setOpen] = useState(false);

  const prefs = config?.prefs ?? DEFAULT_CROSS_SELL_PREFS;
  const messageTpl = config?.message || DEFAULT_CROSS_SELL_MESSAGE;
  const stageSet = useMemo(() => new Set(prefs.stages), [prefs.stages]);
  const offerTelecom = prefs.products.includes("telecom");
  const offerSeguros = prefs.products.includes("seguros");

  // Telecom: telefone (numero) + nome. Seguros: só nome (tabela sem telefone).
  const telecomPhones = useMemo(
    () => buildPhoneKeySet(telecom.map((t) => t.numero)),
    [telecom],
  );
  const telecomNames = useMemo(
    () => new Set(telecom.map((t) => normName(t.nome)).filter(Boolean)),
    [telecom],
  );
  const segurosPhones = useMemo(() => new Set<string>(), []);
  const segurosNames = useMemo(
    () => new Set(seguros.map((s) => normName(s.segurado)).filter(Boolean)),
    [seguros],
  );

  const opportunities = useMemo(() => {
    return energy
      .filter((c) => {
        const stage = c.pos_venda_stage as CrossSellStage | null;
        return stage && stageSet.has(stage);
      })
      .map((c) => {
        const hasTelecom = hasProductMatch({
          leadPhone: c.phone,
          leadName: c.full_name,
          productPhones: telecomPhones,
          productNames: telecomNames,
        });
        const hasSeguro = hasProductMatch({
          leadPhone: c.phone,
          leadName: c.full_name,
          productPhones: segurosPhones,
          productNames: segurosNames,
        });
        return { lead: c, hasTelecom, hasSeguro };
      })
      .filter((o) => {
        const missingTelecom = offerTelecom && !o.hasTelecom;
        const missingSeguro = offerSeguros && !o.hasSeguro;
        return missingTelecom || missingSeguro;
      })
      .slice(0, 30);
  }, [
    energy,
    telecomPhones,
    telecomNames,
    segurosPhones,
    segurosNames,
    stageSet,
    offerTelecom,
    offerSeguros,
  ]);

  if (!consultantId) return null;
  if (loadingE) return null;

  const copy = (phone: string) => {
    navigator.clipboard.writeText(phone).catch(() => {});
    setCopied(phone);
    setTimeout(() => setCopied(null), 1500);
  };

  const waLink = (
    phone: string,
    name: string | null | undefined,
    gaps: { telecom: boolean; seguros: boolean },
  ) => {
    const digits = normPhoneDigits(phone);
    const text = encodeURIComponent(
      applyCrossSellTemplate(messageTpl, {
        fullName: name,
        produto: produtoLabelForGaps(gaps),
      }),
    );
    return `https://wa.me/${digits}?text=${text}`;
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
          >
            <div className="min-w-0">
              <h3 className="font-semibold text-sm">Oportunidades de venda cruzada</h3>
              <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                {opportunities.length} cliente(s) sem Telecom/Seguros
                {!open ? " · toque para ver" : ""}
              </p>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs shrink-0"
          onClick={() => setConfigOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configurar
        </Button>
      </div>

      <CollapsibleContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Clientes de energia que ainda não têm Telecom ou Seguros na sua carteira. Você decide se envia — nada é
          disparado automático.
        </p>

        {opportunities.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">
            Nenhuma oportunidade com os filtros atuais. Ajuste em Configurar se quiser ampliar estágios ou produtos.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border overflow-hidden">
            {opportunities.map(({ lead, hasTelecom, hasSeguro }) => {
              const showTelecom = offerTelecom && !hasTelecom;
              const showSeguro = offerSeguros && !hasSeguro;
              return (
                <li
                  key={lead.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 bg-background hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{lead.full_name || "Sem nome"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {lead.phone} · {lead.city || "?"}/{lead.state || "?"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {showTelecom && (
                      <span
                        title="Sem Telecom"
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px]"
                      >
                        <Smartphone className="h-3 w-3" /> Telecom
                      </span>
                    )}
                    {showSeguro && (
                      <span
                        title="Sem Seguros"
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px]"
                      >
                        <ShieldCheck className="h-3 w-3" /> Seguros
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => copy(lead.phone || "")}
                      title="Copiar número"
                    >
                      {copied === lead.phone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                    <a
                      href={waLink(lead.phone || "", lead.full_name, {
                        telecom: showTelecom,
                        seguros: showSeguro,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[11px] font-medium"
                      title="Abrir WhatsApp com sugestão"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Enviar
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleContent>

      <CrossSellConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        consultantId={consultantId}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["cross-sell-config", consultantId] });
        }}
      />
    </Collapsible>
  );
}
