// BusinessResearchDialog
// ───────────────────────
// Modal de pesquisa de empresas (B2B), no estilo do modal de anúncios:
// 1) Escolhe cidade + ramo (chips rápidos) e busca (prévia, sem gravar).
// 2) Mostra os locais encontrados em cards ricos (nome, telefone, endereço
//    completo, site, horário, categoria) com seleção múltipla.
// 3) Importa só os escolhidos como leads PJ do consultor.
//
// Fonte: OpenStreetMap (gratuito). Os dados são públicos de estabelecimentos.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast as sonnerToast } from "sonner";
import {
  Search, Loader2, MapPin, Phone, Globe, Clock, Building2, Mail, CheckCheck, Download,
} from "lucide-react";
import {
  searchBusinesses, importBusinesses, searchCityNames,
  type ResearchItem, type CityHit,
} from "@/services/capturedLeads";

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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

export function BusinessResearchDialog({ open, onOpenChange, onImported }: Props) {
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
  // Varre o estado inteiro (todas as cidades) em uma única busca.
  const [stateScope, setStateScope] = useState(false);

  // autocomplete de cidades
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [cityPicked, setCityPicked] = useState(false);

  // Busca sugestões de cidade enquanto digita (debounce).
  useEffect(() => {
    if (cityPicked || stateScope) return; // não sugere logo após escolher ou em modo estado
    const q = city.trim();
    if (q.length < 2) { setCityHits([]); return; }
    const t = setTimeout(async () => {
      const hits = await searchCityNames(q);
      setCityHits(hits);
      setShowHits(hits.length > 0);
    }, 250);
    return () => clearTimeout(t);
  }, [city, cityPicked, stateScope]);

  const pickCity = (h: CityHit) => {
    setCity(h.name);
    setUf(h.uf);
    setCityPicked(true);
    setShowHits(false);
    setCityHits([]);
  };

  const keyOf = (it: ResearchItem) => it.osm_id || `${it.name}|${it.phone}`;

  const doSearch = async () => {
    if (stateScope) {
      if (!uf.trim()) { sonnerToast.warning("Digite a UF (ex: MG)."); return; }
      if (!category) {
        sonnerToast.warning("Buscar o estado inteiro sem categoria é muito pesado. Escolha um ramo (ex: Restaurantes).");
        return;
      }
    } else if (!city.trim()) {
      sonnerToast.warning("Digite a cidade.");
      return;
    }
    setSearching(true);
    setSearched(false);
    try {
      const r = await searchBusinesses({
        city: stateScope ? "" : city.trim(),
        uf: uf.trim() || undefined,
        neighbourhood: stateScope ? undefined : (neighbourhood.trim() || undefined),
        category: category || undefined,
        state_scope: stateScope,
        limit: stateScope ? 5000 : 2000,
      });
      if (!r.ok) { sonnerToast.error(r.error || "Falha na busca"); return; }
      const list = r.items || [];
      setItems(list);
      // pré-seleciona os que têm telefone (são os úteis para disparo)
      setSelected(new Set(list.filter((i) => i.phone).map(keyOf)));
      setSearched(true);
      const comTel = list.filter((i) => i.phone).length;
      if (list.length === 0) {
        sonnerToast.info(stateScope
          ? "Nenhum estabelecimento encontrado nesse estado com essa categoria."
          : "Nenhum estabelecimento encontrado. Confira o nome da cidade/bairro.");
      } else if (comTel === 0) {
        sonnerToast.warning("Encontrei locais, mas nenhum tem telefone público cadastrado.");
      } else if (list.length >= (stateScope ? 5000 : 2000)) {
        sonnerToast.info(stateScope
          ? "Muitos resultados! Refine por cidade para não perder nenhum."
          : "Muitos resultados! Use o campo Bairro para varrer a cidade por partes e não perder nada.");
      }
    } finally {
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

  const doImport = async () => {
    const chosen = items.filter((i) => selected.has(keyOf(i)) && i.phone);
    if (chosen.length === 0) { sonnerToast.warning("Selecione ao menos um local com telefone."); return; }
    setImporting(true);
    try {
      const r = await importBusinesses(chosen);
      if (!r.ok) { sonnerToast.error(r.error || "Falha ao salvar"); return; }
      sonnerToast.success(`${r.ingested} salvos na sua lista${r.deduped ? `, ${r.deduped} já existiam` : ""}.`);
      onImported?.();
      onOpenChange(false);
      // reset
      setItems([]); setSelected(new Set()); setSearched(false);
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = items.filter((i) => selected.has(keyOf(i)) && i.phone).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" /> Pesquisar empresas
          </DialogTitle>
          <DialogDescription>
            Busque estabelecimentos por cidade e ramo. Escolha os que quiser e salve na sua lista de leads.
          </DialogDescription>
        </DialogHeader>

        {/* Formulário de busca */}
        <div className="px-5 py-3 space-y-3 border-b border-border bg-card/40 shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Label htmlFor="b-city" className="text-xs">Cidade</Label>
              <Input id="b-city" value={city}
                onChange={(e) => { setCity(e.target.value); setCityPicked(false); }}
                onFocus={() => { if (cityHits.length) setShowHits(true); }}
                placeholder="Digite 'cam' → Campinas..." className="h-9" autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (showHits && cityHits[0]) pickCity(cityHits[0]);
                    else doSearch();
                  }
                  if (e.key === "Escape") setShowHits(false);
                }} />
              {showHits && cityHits.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {cityHits.map((h) => (
                    <button key={`${h.name}-${h.uf}`} type="button"
                      onClick={() => pickCity(h)}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="flex-1">{h.name}</span>
                      <Badge variant="outline" className="text-[10px]">{h.uf}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="w-16">
              <Label htmlFor="b-uf" className="text-xs">UF</Label>
              <Input id="b-uf" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())}
                placeholder="SP" maxLength={2} className="h-9" />
            </div>
            <div className="flex items-end">
              <Button onClick={doSearch} disabled={searching} className="h-9 gap-1.5">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="b-bairro" className="text-xs">Bairro (opcional — para cidade grande, varra por partes)</Label>
            <Input id="b-bairro" value={neighbourhood} onChange={(e) => setNeighbourhood(e.target.value)}
              placeholder="Ex: Cambuí, Barão Geraldo..." className="h-9"
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition ${category === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Resultados */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {!searched ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <MapPin className="w-10 h-10 opacity-30" strokeWidth={1} />
              <p className="text-sm">Digite uma cidade e clique em Buscar.</p>
              <p className="text-xs max-w-sm">Mostramos os estabelecimentos com telefone público para você escolher e salvar.</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <p className="text-sm">Nada encontrado para esses filtros.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 sticky top-0 bg-background/95 backdrop-blur py-1 z-10 gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {items.length} locais · {withPhone.length} com telefone
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
                            {!it.phone && <Badge variant="secondary" className="text-[10px]">sem telefone</Badge>}
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

        <DialogFooter className="px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Fechar</Button>
          <Button onClick={doImport} disabled={importing || selectedCount === 0} className="gap-1.5">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Salvar {selectedCount > 0 ? `(${selectedCount})` : ""} na lista
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
