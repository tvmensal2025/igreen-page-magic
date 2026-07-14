// Diálogo de edição de campanha CTWA já publicada. Duas abas:
// - Rodízio: liga/desliga e substitui os participantes. Salva chamando
//   `facebook-update-campaign-rodizio` (desativa pool antiga + cria nova).
// - Segmentação: cidades + endereços com raio (combináveis). Salva chamando
//   `facebook-update-campaign-targeting` (PATCH nos AdSets da Meta).
//
// Os componentes/serviços de busca já existem — reuso: `AddressRadiusPicker`
// pra pontos com raio e `searchCities` do `facebookAds` pra cidades.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, MapPin, Search, X, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { AddressRadiusPicker, type RadiusPoint } from "./AddressRadiusPicker";
import { listActiveReferralPartners, type RodizioPartnerDraft } from "@/services/referralPartners";
import { searchCities, type CityHit } from "@/services/facebookAds";

interface Campaign {
  id: string;
  name: string;
  cities: any[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  campaign: Campaign | null;
  onSaved?: () => void;
}

interface PersistedCity { key: string; name: string }

/**
 * Reconstrói cidades e pontos de raio a partir do snapshot local salvo em
 * `facebook_campaigns.cities`. Entradas cujo `key` começa com `radius:` foram
 * serializadas pelo `facebook-create-campaign` para preservar geo em modo raio.
 */
function splitPersistedCities(rows: any[]): { cities: PersistedCity[]; radii: RadiusPoint[] } {
  const cities: PersistedCity[] = [];
  const radii: RadiusPoint[] = [];
  for (const r of rows || []) {
    if (!r?.key) continue;
    if (String(r.key).startsWith("radius:")) {
      const m = /^radius:(-?\d+\.?\d*),(-?\d+\.?\d*):(\d+)$/.exec(r.key);
      if (m) {
        radii.push({
          latitude: parseFloat(m[1]),
          longitude: parseFloat(m[2]),
          radius: parseInt(m[3], 10),
          address_string: r.name || "",
          name: (r.name || "").replace(/\s*\(\d+km\)\s*$/, ""),
        });
      }
    } else {
      cities.push({ key: r.key, name: r.name || r.key });
    }
  }
  return { cities, radii };
}

export function EditCampaignDialog({ open, onClose, campaign, onSaved }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"rodizio" | "geo">("rodizio");
  const [savingGeo, setSavingGeo] = useState(false);
  const [savingRod, setSavingRod] = useState(false);

  // ── Rodízio ──
  const [rodEnabled, setRodEnabled] = useState(false);
  const [partners, setPartners] = useState<RodizioPartnerDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [currentPoolLoaded, setCurrentPoolLoaded] = useState(false);

  // ── Geo ──
  const [cities, setCities] = useState<PersistedCity[]>([]);
  const [radii, setRadii] = useState<RadiusPoint[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [searchingCity, setSearchingCity] = useState(false);

  const partnersById = useMemo(() => {
    const m: Record<string, RodizioPartnerDraft> = {};
    for (const p of partners) m[p.id] = p;
    return m;
  }, [partners]);

  useEffect(() => {
    if (!open || !campaign) return;
    setTab("rodizio");
    const split = splitPersistedCities(campaign.cities || []);
    setCities(split.cities);
    setRadii(split.radii);
    setCityQuery("");
    setCityHits([]);
    setCurrentPoolLoaded(false);
    setSelectedIds([]);
    setRodEnabled(false);

    // Carrega participantes disponíveis + pool ativa da campanha
    (async () => {
      setLoadingPartners(true);
      try {
        const [list] = await Promise.all([listActiveReferralPartners()]);
        setPartners(list);
      } catch (e: any) {
        toast({ title: "Erro ao carregar participantes", description: e?.message || "", variant: "destructive" });
      } finally { setLoadingPartners(false); }

      try {
        const { data: pool } = await (supabase as any)
          .from("rodizio_pools")
          .select("id")
          .eq("campaign_id", campaign.id)
          .eq("is_enabled", true)
          .maybeSingle();
        if (pool?.id) {
          const { data: members } = await (supabase as any)
            .from("rodizio_pool_members")
            .select("partner_id, position")
            .eq("pool_id", pool.id)
            .order("position", { ascending: true });
          const ids = ((members as any[]) || []).map((m) => m.partner_id).filter(Boolean);
          setSelectedIds(ids);
          setRodEnabled(ids.length >= 1);
        }
      } catch { /* pool pode não existir — modo destino único */ }
      setCurrentPoolLoaded(true);
    })();
  }, [open, campaign, toast]);

  // Busca cidades (debounce simples)
  useEffect(() => {
    if (!cityQuery || cityQuery.length < 2) { setCityHits([]); return; }
    const h = setTimeout(async () => {
      setSearchingCity(true);
      try {
        const res = await searchCities(cityQuery);
        setCityHits(res.cities || []);
      } catch { /* ignore */ }
      finally { setSearchingCity(false); }
    }, 350);
    return () => clearTimeout(h);
  }, [cityQuery]);

  function addCity(hit: CityHit) {
    if (cities.some((c) => c.key === hit.key)) return;
    if (cities.length >= 200) return;
    setCities([...cities, { key: hit.key, name: hit.name + (hit.region ? `, ${hit.region}` : "") }]);
    setCityQuery("");
    setCityHits([]);
  }
  function removeCity(key: string) {
    setCities(cities.filter((c) => c.key !== key));
  }

  function togglePartner(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function movePartner(id: string, dir: -1 | 1) {
    setSelectedIds((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleSaveRodizio() {
    if (!campaign) return;
    if (rodEnabled && selectedIds.length < 1) {
      return toast({ title: "Selecione pelo menos 1 participante", variant: "destructive" });
    }
    setSavingRod(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-update-campaign-rodizio", {
        body: { campaign_id: campaign.id, enabled: rodEnabled, partner_ids: rodEnabled ? selectedIds : [] },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Rodízio atualizado", description: rodEnabled ? `Nova pool com ${selectedIds.length} participante(s).` : "Rodízio desativado — destino único." });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao atualizar rodízio", description: e?.message || "Erro", variant: "destructive" });
    } finally { setSavingRod(false); }
  }

  async function handleSaveGeo() {
    if (!campaign) return;
    if (cities.length === 0 && radii.length === 0) {
      return toast({ title: "Adicione pelo menos 1 cidade ou 1 endereço com raio", variant: "destructive" });
    }
    setSavingGeo(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-update-campaign-targeting", {
        body: {
          campaign_id: campaign.id,
          cities: cities.map((c) => ({ key: c.key, name: c.name })),
          custom_locations: radii.map((p) => ({
            latitude: p.latitude, longitude: p.longitude, radius: p.radius,
            address_string: p.address_string, name: p.name,
          })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const upd = (data as any)?.updated_adsets ?? 0;
      const tot = (data as any)?.total_adsets ?? 0;
      toast({
        title: "Segmentação atualizada",
        description: `${upd}/${tot} AdSet(s) atualizados na Meta. Pode levar alguns minutos para propagar.`,
      });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao atualizar segmentação", description: e?.message || "Erro", variant: "destructive" });
    } finally { setSavingGeo(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !savingGeo && !savingRod && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar campanha — {campaign?.name}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="rodizio" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Rodízio</TabsTrigger>
            <TabsTrigger value="geo" className="gap-1.5"><MapPin className="w-3.5 h-3.5" /> Segmentação</TabsTrigger>
          </TabsList>

          {/* ── Aba Rodízio ── */}
          <TabsContent value="rodizio" className="space-y-3 pt-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium text-sm">Quem recebe os leads</div>
                <div className="text-xs text-muted-foreground">
                  1 pessoa = destino exclusivo (leads + métricas horárias). 2 ou mais = rodízio circular.
                </div>
              </div>
              <Switch checked={rodEnabled} onCheckedChange={setRodEnabled} disabled={!currentPoolLoaded} />
            </div>

            {rodEnabled && (
              <div className="space-y-2">
                <Label className="text-xs">Participantes disponíveis</Label>
                {loadingPartners ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
                ) : partners.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhum participante cadastrado. Crie participantes primeiro (menu Rodízio).</div>
                ) : (
                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                    {partners.map((p) => {
                      const checked = selectedIds.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent cursor-pointer text-sm">
                          <input type="checkbox" checked={checked} onChange={() => togglePartner(p.id)} />
                          <span className="flex-1 truncate">{p.nome}</span>
                          <Badge variant="outline" className="text-[10px]">{p.tipo}</Badge>
                        </label>
                      );
                    })}
                  </div>
                )}

                {selectedIds.length > 0 && (
                  <div>
                    <Label className="text-xs">Ordem do rodízio (arraste ou use as setas)</Label>
                    <div className="rounded-lg border divide-y">
                      {selectedIds.map((id, i) => {
                        const p = partnersById[id];
                        return (
                          <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                            <span className="w-6 text-center font-bold text-primary">{i + 1}</span>
                            <span className="flex-1 truncate">{p?.nome || id}</span>
                            <Button variant="ghost" size="sm" className="h-7 px-2" disabled={i === 0} onClick={() => movePartner(id, -1)}>↑</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2" disabled={i === selectedIds.length - 1} onClick={() => movePartner(id, 1)}>↓</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => togglePartner(id)}><X className="w-3.5 h-3.5" /></Button>
                          </div>
                        );
                      })}
                    </div>
                    {selectedIds.length === 1 && (
                      <p className="text-xs text-primary mt-1">
                        Destino exclusivo: todos os leads e o aviso horário vão para esta pessoa.
                      </p>
                    )}
                  </div>
                )}
                {selectedIds.length === 0 && (
                  <p className="text-xs text-destructive mt-1">Selecione pelo menos 1 participante.</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={savingRod}>Cancelar</Button>
              <Button onClick={handleSaveRodizio} disabled={savingRod || !currentPoolLoaded} className="gap-1.5">
                {savingRod ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar rodízio
              </Button>
            </div>
          </TabsContent>

          {/* ── Aba Segmentação ── */}
          <TabsContent value="geo" className="space-y-4 pt-3">
            <p className="text-xs text-muted-foreground">
              Combine cidades inteiras e/ou endereços com raio. A Meta aceita os dois juntos —
              o alcance é a união das áreas.
            </p>

            {/* Cidades */}
            <div>
              <Label className="text-sm flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Cidades ({cities.length}/200)</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Digite a cidade…" value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} />
              </div>
              {searchingCity && <div className="text-xs text-muted-foreground mt-1">Buscando…</div>}
              {cityHits.length > 0 && (
                <div className="mt-1 border rounded-lg divide-y max-h-40 overflow-y-auto">
                  {cityHits.map((h) => (
                    <button key={h.key} type="button" onClick={() => addCity(h)} className="w-full text-left px-3 py-1.5 hover:bg-accent text-sm">
                      {h.name}{h.region ? `, ${h.region}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {cities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {cities.map((c) => (
                    <Badge key={c.key} variant="secondary" className="gap-1.5 py-1 px-2 text-xs">
                      {c.name}
                      <button onClick={() => removeCity(c.key)} aria-label="Remover"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Endereços com raio */}
            <div className="border-t pt-3">
              <AddressRadiusPicker value={radii} onChange={setRadii} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={savingGeo}>Cancelar</Button>
              <Button onClick={handleSaveGeo} disabled={savingGeo} className="gap-1.5">
                {savingGeo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar segmentação
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
