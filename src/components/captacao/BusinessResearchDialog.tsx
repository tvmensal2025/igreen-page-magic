// BusinessResearchDialog
// ───────────────────────
// Pesquisa B2B de empresas com telefone público (OpenStreetMap).
// - Uma cidade: busca e salva TODOS os telefones de uma vez.
// - UF inteira: enfileira no servidor (lead_research_sweeps + cron),
//   salva em captured_leads cidade a cidade. Sem WhatsApp.

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast as sonnerToast } from "sonner";
import {
  Search, Loader2, MapPin, Phone, Globe, Clock, Building2, Mail, CheckCheck, Download, Square, Play,
} from "lucide-react";
import {
  searchBusinesses, importBusinesses, searchCityNames, harvestCityPhones,
  startUfPhoneSweep, getUfPhoneSweepStatus, cancelUfPhoneSweep,
  type ResearchItem, type CityHit, type SweepJob, type SweepCityLog,
} from "@/services/capturedLeads";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

const CATEGORIES = [
  { id: "", label: "Tudo" },
  { id: "restaurante", label: "Restaurantes" },
  { id: "bar", label: "Bares" },
  { id: "cafe", label: "Cafés" },
  { id: "padaria", label: "Padarias" },
  { id: "mercado", label: "Mercados" },
  { id: "farmacia", label: "Farmácias" },
  { id: "academia", label: "Academias" },
  { id: "salao", label: "Salões/Beleza" },
  { id: "oficina", label: "Oficinas" },
  { id: "loja", label: "Lojas" },
  { id: "hotel", label: "Hotéis" },
  { id: "escritorio", label: "Escritórios" },
  { id: "posto", label: "Postos" },
];

const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

type Mode = "city" | "uf_sweep";

export function BusinessResearchDialog({ open, onOpenChange, onImported }: Props) {
  const [mode, setMode] = useState<Mode>("city");
  const [city, setCity] = useState("");
  const [uf, setUf] = useState("");
  const [neighbourhood, setNeighbourhood] = useState("");
  const [category, setCategory] = useState("");
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState(false);
  const [onlyPhone, setOnlyPhone] = useState(true);

  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [cityPicked, setCityPicked] = useState(false);

  const [sweepId, setSweepId] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepJob | null>(null);
  const [sweepPending, setSweepPending] = useState(0);
  const [sweepLogs, setSweepLogs] = useState<SweepCityLog[]>([]);
  const [sweepStarting, setSweepStarting] = useState(false);
  const lastIngestedRef = useRef(0);

  useEffect(() => {
    if (cityPicked || mode !== "city") return;
    const q = city.trim();
    if (q.length < 2) { setCityHits([]); return; }
    const t = setTimeout(async () => {
      const hits = await searchCityNames(q, uf.trim() || undefined);
      setCityHits(hits);
      setShowHits(hits.length > 0);
    }, 250);
    return () => clearTimeout(t);
  }, [city, cityPicked, mode, uf]);

  useEffect(() => {
    if (!open || mode !== "uf_sweep") return;
    let cancelled = false;
    (async () => {
      const st = await getUfPhoneSweepStatus(sweepId || undefined);
      if (cancelled || !st.ok || !st.sweep) return;
      setSweep(st.sweep);
      setSweepId(st.sweep.id);
      setSweepPending(st.pending ?? 0);
      setSweepLogs(st.recent || []);
      if (!uf) setUf(st.sweep.uf);
      lastIngestedRef.current = st.sweep.ingested;
    })();
    return () => { cancelled = true; };
    // Só no open/mode — não re-poll aqui
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "uf_sweep" || !sweepId) return;
    if (sweep && sweep.status !== "running") return;
    const t = setInterval(async () => {
      const st = await getUfPhoneSweepStatus(sweepId);
      if (!st.ok || !st.sweep) return;
      setSweep(st.sweep);
      setSweepPending(st.pending ?? 0);
      setSweepLogs(st.recent || []);
      if (st.sweep.ingested > lastIngestedRef.current) {
        lastIngestedRef.current = st.sweep.ingested;
        onImported?.();
      }
      if (st.sweep.status === "done") {
        sonnerToast.success(
          `UF ${st.sweep.uf} concluída · ${st.sweep.ingested} salvos · ${st.sweep.found_phones} telefones`,
        );
        onImported?.();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [open, mode, sweepId, sweep?.status, onImported]);

  const pickCity = (h: CityHit) => {
    setCity(h.name);
    setUf(h.uf);
    setCityPicked(true);
    setShowHits(false);
    setCityHits([]);
  };

  const keyOf = (it: ResearchItem) => it.osm_id || `${it.name}|${it.phone}`;

  const doSearch = async () => {
    if (!city.trim()) { sonnerToast.warning("Digite a cidade."); return; }
    if (!uf.trim()) {
      sonnerToast.warning("Selecione a cidade na lista (ou digite a UF).");
      return;
    }
    setSearching(true);
    setSearched(false);
    try {
      const r = await searchBusinesses({
        city: city.trim(),
        uf: uf.trim(),
        neighbourhood: neighbourhood.trim() || undefined,
        category: category || undefined,
        limit: 0,
      });
      if (!r.ok) { sonnerToast.error(r.error || "Falha na busca"); return; }
      const list = r.items || [];
      setItems(list);
      setSelected(new Set(list.filter((i) => i.phone).map(keyOf)));
      setSearched(true);
      if (r.city) setCity(r.city);
      if (r.uf) setUf(String(r.uf));
      const comTel = list.filter((i) => i.phone).length;
      if (comTel === 0) {
        sonnerToast.info("Nenhum telefone público nesta cidade com esses filtros.");
      } else {
        sonnerToast.success(`${comTel} telefone${comTel === 1 ? "" : "s"} · ${r.city || city}/${r.uf || uf}`);
      }
    } finally {
      setSearching(false);
    }
  };

  const doHarvestCity = async () => {
    if (!city.trim()) { sonnerToast.warning("Digite a cidade."); return; }
    if (!uf.trim()) {
      sonnerToast.warning("Selecione a cidade na lista (ou digite a UF).");
      return;
    }
    setImporting(true);
    setSearching(true);
    try {
      const r = await harvestCityPhones({
        city: city.trim(),
        uf: uf.trim(),
        category: category || undefined,
        neighbourhood: neighbourhood.trim() || undefined,
      });
      if (!r.ok) {
        sonnerToast.error(r.error || "Falha ao buscar/salvar");
        if (r.ingested > 0) onImported?.();
        return;
      }
      if (r.found === 0) {
        sonnerToast.info(`Nenhum telefone em ${r.city}/${r.uf}.`);
      } else {
        sonnerToast.success(
          `${r.ingested} salvos · ${r.found} encontrados` +
            (r.deduped ? ` · ${r.deduped} já existiam` : "") +
            ` · ${r.city}/${r.uf}`,
        );
      }
      onImported?.();
      setItems([]);
      setSelected(new Set());
      setSearched(false);
    } finally {
      setImporting(false);
      setSearching(false);
    }
  };

  const toggle = (it: ResearchItem) => {
    const k = keyOf(it);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };

  const withPhone = items.filter((i) => i.phone);
  const allPhoneSelected = withPhone.length > 0 && withPhone.every((i) => selected.has(keyOf(i)));
  const toggleAllPhone = () => {
    if (allPhoneSelected) setSelected(new Set());
    else setSelected(new Set(withPhone.map(keyOf)));
  };

  const doImportSelected = async () => {
    const chosen = items.filter((i) => selected.has(keyOf(i)) && i.phone);
    if (chosen.length === 0) {
      sonnerToast.warning("Nenhum telefone selecionado — use “Salvar todos”.");
      return;
    }
    setImporting(true);
    try {
      const r = await importBusinesses(chosen);
      if (!r.ok) {
        sonnerToast.error(r.error || "Falha ao salvar");
        if (r.ingested && r.ingested > 0) onImported?.();
        return;
      }
      sonnerToast.success(
        `${r.ingested ?? 0} salvos${r.deduped ? `, ${r.deduped} já existiam` : ""}.`,
      );
      onImported?.();
      setItems([]);
      setSelected(new Set());
      setSearched(false);
    } finally {
      setImporting(false);
    }
  };

  const startUfSweep = async () => {
    const ufClean = uf.trim().toUpperCase();
    if (ufClean.length !== 2) {
      sonnerToast.warning("Escolha a UF (ex: MG).");
      return;
    }
    setSweepStarting(true);
    try {
      const r = await startUfPhoneSweep({ uf: ufClean, category: category || "" });
      if (!r.ok || !r.sweep_id) {
        sonnerToast.error(r.error || r.detail || "Falha ao iniciar varredura");
        return;
      }
      setSweepId(r.sweep_id);
      const st = await getUfPhoneSweepStatus(r.sweep_id);
      if (st.sweep) {
        setSweep(st.sweep);
        setSweepPending(st.pending ?? 0);
        setSweepLogs(st.recent || []);
        lastIngestedRef.current = st.sweep.ingested;
      }
      if (r.reused) {
        sonnerToast.info(`Varredura ${ufClean} já em andamento — acompanhando.`);
      } else if (r.resumed) {
        sonnerToast.success(`Varredura ${ufClean} retomada.`);
      } else {
        sonnerToast.success(
          `Varredura ${ufClean} enfileirada · ${r.total_cities} cidades. Telefones salvos no servidor.`,
        );
      }
    } finally {
      setSweepStarting(false);
    }
  };

  const stopUfSweep = async () => {
    if (!sweepId) return;
    const r = await cancelUfPhoneSweep(sweepId);
    if (!r.ok) {
      sonnerToast.error(r.error || "Falha ao pausar");
      return;
    }
    const st = await getUfPhoneSweepStatus(sweepId);
    if (st.sweep) setSweep(st.sweep);
    sonnerToast.info("Varredura pausada. Pode retomar depois.");
  };

  const selectedCount = items.filter((i) => selected.has(keyOf(i)) && i.phone).length;
  const sweepTotal = sweep?.total_cities ?? 0;
  const sweepDone = sweep?.done_cities ?? 0;
  const sweepPct = sweepTotal > 0 ? Math.round((sweepDone / sweepTotal) * 100) : 0;
  const sweeping = sweep?.status === "running";
  const busy = searching || importing || sweepStarting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" /> Pesquisar empresas
          </DialogTitle>
          <DialogDescription>
            Busca telefones públicos e salva na Captação. Não dispara WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-3 border-b border-border bg-card/40 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy || sweeping} onClick={() => setMode("city")}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition ${mode === "city" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
              Uma cidade
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("uf_sweep")}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition ${mode === "uf_sweep" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
              UF inteira (salva no servidor)
            </button>
          </div>

          {mode === "city" ? (
            <>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Label htmlFor="b-city" className="text-xs">Cidade</Label>
                  <Popover open={showHits && cityHits.length > 0} onOpenChange={(o) => { if (!o) setShowHits(false); }}>
                    <PopoverAnchor asChild>
                      <Input id="b-city" value={city}
                        disabled={busy}
                        onChange={(e) => { setCity(e.target.value); setCityPicked(false); }}
                        onFocus={() => { if (cityHits.length) setShowHits(true); }}
                        placeholder="Digite e escolha na lista…" className="h-9" autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (showHits && cityHits[0]) pickCity(cityHits[0]);
                            else void doHarvestCity();
                          }
                          if (e.key === "Escape") setShowHits(false);
                        }} />
                    </PopoverAnchor>
                    <PopoverContent
                      align="start"
                      sideOffset={4}
                      className="w-[var(--radix-popover-trigger-width)] p-0 max-h-56 overflow-y-auto"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      {cityHits.map((h) => (
                        <button key={`${h.name}-${h.uf}`} type="button"
                          onClick={() => pickCity(h)}
                          className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="flex-1">{h.name}</span>
                          <Badge variant="outline" className="text-[10px]">{h.uf}</Badge>
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="w-16">
                  <Label htmlFor="b-uf" className="text-xs">UF</Label>
                  <Input id="b-uf" value={uf} disabled={busy}
                    onChange={(e) => setUf(e.target.value.toUpperCase())}
                    placeholder="MG" maxLength={2} className="h-9" />
                </div>
              </div>
              <div>
                <Label htmlFor="b-bairro" className="text-xs">Bairro (opcional)</Label>
                <Input id="b-bairro" value={neighbourhood} disabled={busy}
                  onChange={(e) => setNeighbourhood(e.target.value)}
                  placeholder="Ex: Centro…" className="h-9" />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">UF — enfileira todos os municípios IBGE no servidor</Label>
              <div className="flex flex-wrap gap-1">
                {UFS.map((u) => (
                  <button key={u} type="button" disabled={busy || sweeping}
                    onClick={() => setUf(u)}
                    className={`text-[11px] w-9 py-1 rounded border transition ${uf === u ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
                    {u}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                O servidor busca e salva os telefones cidade a cidade (~2/min). Pode fechar o modal.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.id || "all"} type="button" disabled={busy || sweeping}
                onClick={() => setCategory(c.id)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition ${category === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {mode === "uf_sweep" ? (
            <div className="space-y-3">
              {sweep ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {sweep.status === "running"
                          ? `Servidor processando ${sweep.uf}: ${sweepDone}/${sweepTotal} cidades`
                          : `Varredura ${sweep.uf}: ${sweep.status} · ${sweepDone}/${sweepTotal}`}
                      </span>
                      <span>{sweepPct}%</span>
                    </div>
                    <Progress value={sweepPct} className="h-2" />
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span><strong>{sweep.found_phones}</strong> telefones achados</span>
                      <span><strong>{sweep.ingested}</strong> salvos</span>
                      <span><strong>{sweep.deduped}</strong> já existiam</span>
                      <span><strong>{sweepPending}</strong> na fila</span>
                      {sweep.errors > 0 && (
                        <span className="text-destructive"><strong>{sweep.errors}</strong> erros</span>
                      )}
                    </div>
                  </div>
                  {sweepLogs.length > 0 && (
                    <div className="rounded-md border divide-y max-h-64 overflow-y-auto text-xs">
                      {sweepLogs.map((l, idx) => (
                        <div key={`${l.city}-${idx}`} className="px-3 py-1.5 flex gap-2 justify-between">
                          <span className="font-medium">{l.city}</span>
                          <span className="text-muted-foreground shrink-0">
                            {l.status === "running"
                              ? "processando…"
                              : l.error
                                ? String(l.error).slice(0, 40)
                                : `${l.ingested} salvos · ${l.found} achados` + (l.deduped ? ` · ${l.deduped} dup` : "")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                  <MapPin className="w-10 h-10 opacity-30" strokeWidth={1} />
                  <p className="text-sm">Escolha a UF e clique em Iniciar varredura.</p>
                  <p className="text-xs max-w-sm">
                    Telefones públicos são buscados e salvos automaticamente na Captação.
                  </p>
                </div>
              )}
            </div>
          ) : !searched ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Phone className="w-10 h-10 opacity-30" strokeWidth={1} />
              <p className="text-sm">Escolha a cidade e salve todos os telefones de uma vez.</p>
              <p className="text-xs max-w-sm">
                “Salvar todos” busca e grava na lista sem deixar número de fora.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <p className="text-sm">Nada encontrado para esses filtros.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 sticky top-0 bg-background/95 backdrop-blur py-1 z-10 gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {withPhone.length} telefones
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOnlyPhone((v) => !v)}
                    className={`text-[11px] px-2 py-1 rounded-full border transition ${onlyPhone ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
                    {onlyPhone ? "Só com telefone" : "Mostrar todos"}
                  </button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={toggleAllPhone}>
                    <CheckCheck className="w-3.5 h-3.5" />
                    {allPhoneSelected ? "Limpar" : "Selecionar todos"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {(onlyPhone ? withPhone : items).map((it) => {
                  const k = keyOf(it);
                  const sel = selected.has(k);
                  return (
                    <div key={k}
                      onClick={() => it.phone && toggle(it)}
                      className={`rounded-lg border p-3 transition ${!it.phone ? "opacity-50" : "cursor-pointer hover:border-primary/50"} ${sel ? "border-primary bg-primary/5" : "border-border"}`}>
                      <div className="flex items-start gap-2.5">
                        <Checkbox checked={sel} disabled={!it.phone}
                          onCheckedChange={() => it.phone && toggle(it)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{it.name}</span>
                            {it.category && <Badge variant="outline" className="text-[10px]">{it.category}</Badge>}
                          </div>
                          <div className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                            {it.phone && <div className="flex items-center gap-1.5 text-foreground"><Phone className="w-3 h-3 text-primary" />{it.phone}</div>}
                            {it.full_address && <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{it.full_address}</div>}
                            {it.email && <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{it.email}</div>}
                            {it.website && <div className="flex items-center gap-1.5"><Globe className="w-3 h-3" /><span className="truncate max-w-[280px]">{it.website}</span></div>}
                            {it.opening_hours && <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />{it.opening_hours}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border shrink-0 gap-2 flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing || sweepStarting}>
            Fechar
          </Button>
          {mode === "uf_sweep" ? (
            sweeping ? (
              <Button variant="destructive" onClick={() => void stopUfSweep()} className="gap-1.5">
                <Square className="w-4 h-4" /> Pausar varredura
              </Button>
            ) : (
              <Button onClick={() => void startUfSweep()} disabled={!uf.trim() || sweepStarting} className="gap-1.5">
                {sweepStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {sweep?.status === "paused" ? `Retomar (${uf})` : `Iniciar varredura ${uf ? `(${uf})` : ""}`}
              </Button>
            )
          ) : (
            <>
              <Button variant="secondary" onClick={() => void doSearch()} disabled={busy} className="gap-1.5">
                {searching && !importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Só buscar
              </Button>
              {searched && selectedCount > 0 && (
                <Button variant="outline" onClick={() => void doImportSelected()} disabled={busy} className="gap-1.5">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Salvar seleção ({selectedCount})
                </Button>
              )}
              <Button onClick={() => void doHarvestCity()} disabled={busy} className="gap-1.5">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Salvar todos os telefones
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
