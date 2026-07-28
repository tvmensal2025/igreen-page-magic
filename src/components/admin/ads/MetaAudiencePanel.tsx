/**
 * Painel: como a Custom Audience é preenchida + contagens por dia + DDDs.
 * Captação (cidade/km) ≠ Audience (telefone hasheado do CRM).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { Loader2, Users, RefreshCw, MapPin, Info } from "lucide-react";
import { MG_RETARGET_DDD_ALLOWLIST, RAFAEL_MARKET_DDD_ALLOWLIST } from "@/lib/cityToDdd";

const DDD_PRESETS = [...MG_RETARGET_DDD_ALLOWLIST] as const;

interface Props {
  consultantId: string;
}

interface DayRow {
  day: string;
  ok: number;
  fail: number;
}

export function MetaAudiencePanel({ consultantId }: Props) {
  const { toast } = useToast();
  const { isSuperAdmin, isAdmin } = useUserRole(consultantId);
  const canEditDdd = isSuperAdmin || isAdmin;

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingDdd, setSavingDdd] = useState(false);
  const [audienceId, setAudienceId] = useState<string | null>(null);
  const [audienceSyncedAt, setAudienceSyncedAt] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [ddds, setDdds] = useState<number[]>([...RAFAEL_MARKET_DDD_ALLOWLIST]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [totalOk, setTotalOk] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: pf } = await (supabase as any)
        .from("platform_facebook_audience_status")
        .select("custom_audience_id, audience_synced_at, audience_source_count, retarget_ddd_allowlist")
        .eq("id", true)
        .maybeSingle();
      setAudienceId(pf?.custom_audience_id || null);
      setAudienceSyncedAt(pf?.audience_synced_at || null);
      setSourceCount(typeof pf?.audience_source_count === "number" ? pf.audience_source_count : null);
      const list = Array.isArray(pf?.retarget_ddd_allowlist) && pf.retarget_ddd_allowlist.length
        ? pf.retarget_ddd_allowlist.map(Number)
        : [...MG_RETARGET_DDD_ALLOWLIST];
      setDdds(list);

      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      let q = (supabase as any)
        .from("meta_audience_sync_log")
        .select("ok, created_at, phone_ddd")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (!canEditDdd) q = q.eq("consultant_id", consultantId);
      const { data: logs } = await q;
      const byDay = new Map<string, DayRow>();
      let okSum = 0;
      for (const row of logs || []) {
        const day = String(row.created_at || "").slice(0, 10);
        if (!day) continue;
        const cur = byDay.get(day) || { day, ok: 0, fail: 0 };
        if (row.ok) {
          cur.ok += 1;
          okSum += 1;
        } else cur.fail += 1;
        byDay.set(day, cur);
      }
      setDays([...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)));
      setTotalOk(okSum);
    } catch (e: any) {
      toast({ title: "Falha ao carregar audience", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [consultantId, canEditDdd, toast]);

  useEffect(() => { void load(); }, [load]);

  function toggleDdd(d: number) {
    setDdds((prev) => {
      if (prev.includes(d)) {
        const next = prev.filter((x) => x !== d);
        return next.length ? next : prev; // nunca zera
      }
      return [...prev, d].sort((a, b) => a - b);
    });
  }

  function selectAllMg() {
    setDdds([...MG_RETARGET_DDD_ALLOWLIST]);
  }

  function selectConsultantMarket() {
    setDdds([...RAFAEL_MARKET_DDD_ALLOWLIST]);
  }

  async function saveDdds() {
    if (!canEditDdd) return;
    setSavingDdd(true);
    try {
      const { error } = await (supabase as any)
        .from("platform_facebook_account")
        .update({ retarget_ddd_allowlist: ddds })
        .eq("id", true);
      if (error) throw error;
      toast({ title: "DDDs salvos", description: `Remarketing só sobe DDD ${ddds.join(", ")}.` });
    } catch (e: any) {
      toast({ title: "Falha ao salvar DDDs", description: e?.message, variant: "destructive" });
    } finally {
      setSavingDdd(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      // Cria/atualiza Custom Audience (clientes ativos) se ainda não existir.
      const { data: aud, error: audErr } = await supabase.functions.invoke("facebook-sync-audiences", {
        body: { scope: "platform" },
      });
      if (audErr && canEditDdd) {
        // Consultor comum pode não ter permissão de platform — tenta retarget mesmo assim.
        console.warn("[audience] sync-audiences:", audErr.message);
      }
      const { data, error } = await supabase.functions.invoke("facebook-retarget-sync", { body: {} });
      if (error) throw error;
      const added = Array.isArray((data as any)?.results)
        ? (data as any).results.reduce((s: number, r: any) => s + Number(r.added || 0), 0)
        : Number((data as any)?.uploaded || (aud as any)?.uploaded || 0);
      toast({
        title: "Sincronização enviada",
        description: audienceId || (aud as any)?.custom_audience_id
          ? `Audience OK. Lote reportou ~${added} contato(s). Veja o log por dia abaixo.`
          : "Rode como Super Admin em Plataforma FB → Sincronizar tudo se a audience ainda não existir.",
      });
      await load();
    } catch (e: any) {
      toast({ title: "Falha no sync", description: e?.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Público Meta (Custom Audience)
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            O anúncio de <strong>cidade/km</strong> mostra o criativo para quem está naquela região.
            A <strong>Audience</strong> é outra coisa: sobe telefone/e-mail (hash) dos leads do CRM
            para remarketing. Na criação de campanha o sistema escolhe a região sozinho;
            ajuste abaixo só se precisar filtrar a base.
          </p>
        </div>
        <Button size="sm" onClick={() => void syncNow()} disabled={syncing} className="gap-1.5">
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar agora
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary" className="gap-1">
              Audience: {audienceId ? `${audienceId.slice(0, 8)}…` : "ainda não criada"}
            </Badge>
            {audienceSyncedAt && (
              <Badge variant="outline">
                Última sync: {new Date(audienceSyncedAt).toLocaleString("pt-BR")}
              </Badge>
            )}
            {sourceCount != null && (
              <Badge variant="outline">Base enviada: {sourceCount}</Badge>
            )}
            <Badge variant="outline">OK (14 dias): {totalOk}</Badge>
          </div>

          <div className="rounded-lg border border-border/60 p-3 space-y-2">
            <div className="text-xs font-medium flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> DDDs no remarketing
              {!canEditDdd && <span className="text-muted-foreground font-normal">(somente Super Admin altera)</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DDD_PRESETS.map((d) => {
                const on = ddds.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!canEditDdd}
                    onClick={() => toggleDdd(d)}
                    className={`text-xs px-2.5 py-1 rounded-md border ${
                      on
                        ? "bg-primary/15 border-primary/40 text-foreground font-semibold"
                        : "bg-secondary/40 border-transparent text-muted-foreground"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            {canEditDdd && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectConsultantMarket}>
                Suas cidades (31, 34, 38)
              </Button>
            )}
            {canEditDdd && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAllMg}>
                Minas inteira (31–38)
              </Button>
            )}
            {canEditDdd && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void saveDdds()} disabled={savingDdd}>
                {savingDdd ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Salvar DDDs
              </Button>
            )}
            <p className="text-[10px] text-muted-foreground flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Ao criar campanha com “É remarketing?” ligado, os DDDs das cidades entram na lista.
              Padrão recomendado: <strong>Minas inteira</strong> (31, 32, 33, 34, 35, 37, 38). Lead com DDD fora da lista é pulado no log.
            </p>
          </div>

          <div>
            <div className="text-xs font-medium mb-1.5">Adicionados por dia (últimos 14)</div>
            {days.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Ainda sem log. Clique em Atualizar (ou aguarde as mensagens automáticas) — cada upload grava o dia aqui.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-1.5">
                {days.map((d) => (
                  <div key={d.day} className="flex items-center justify-between text-xs rounded-md bg-secondary/40 px-2.5 py-1.5">
                    <span>{d.day.split("-").reverse().join("/")}</span>
                    <span>
                      <strong className="text-primary">{d.ok}</strong> ok
                      {d.fail > 0 && <span className="text-muted-foreground"> · {d.fail} filtrados/erro</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
