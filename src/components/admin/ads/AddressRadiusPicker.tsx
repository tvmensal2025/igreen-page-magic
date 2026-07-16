// Picker de endereço/raio para segmentação ultra-local (rua, bairro, ponto de referência).
// Usa Nominatim (OpenStreetMap) para autocomplete — gratuito, sem chave de API.
// Saída: lista de pontos { latitude, longitude, radius_km, address_string } (até 200).
import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, X, Loader2 } from "lucide-react";

export interface RadiusPoint {
  latitude: number;
  longitude: number;
  radius: number; // km, 1-50
  address_string: string;
  name?: string;
}

interface Props {
  value: RadiusPoint[];
  onChange: (next: RadiusPoint[]) => void;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  place_id: number;
}

export function AddressRadiusPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(10);
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [pending, setPending] = useState<RadiusPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoadingSugg(true);
      setError(null);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=8&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("Falha na busca");
        const data: NominatimResult[] = await res.json();
        setSuggestions(data || []);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          console.warn("nominatim falhou", e);
          setError("Não foi possível buscar endereços agora. Tente novamente.");
        }
      } finally {
        setLoadingSugg(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  function pickSuggestion(s: NominatimResult) {
    const pt: RadiusPoint = {
      latitude: parseFloat(s.lat),
      longitude: parseFloat(s.lon),
      radius,
      address_string: s.display_name,
      name: s.display_name.split(",")[0],
    };
    setPending(pt);
    setQuery(pt.address_string);
    setSuggestions([]);
  }

  function confirmPending() {
    if (!pending) return;
    if (value.length >= 200) return;
    onChange([...value, { ...pending, radius }]);
    setPending(null);
    setQuery("");
  }

  // Atualiza pending.radius enquanto o slider mexe
  useEffect(() => {
    if (pending) setPending({ ...pending, radius });
    // eslint-disable-next-line
  }, [radius]);

  function removePoint(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-primary" />
          Endereço (rua, bairro, ponto de referência)
        </Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Anuncie só na rua, no bairro, ou em volta de um endereço específico. Mínimo 1 km, máximo 50 km.
        </p>
        <div className="relative mt-1">
          <Input
            placeholder="Ex: Rua das Flores 123, São Paulo"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPending(null); }}
          />
          {loadingSugg && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Buscando via OpenStreetMap</p>
        {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
        {suggestions.length > 0 && (
          <div className="mt-1 border rounded-lg bg-card divide-y max-h-48 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.place_id}
                type="button"
                onClick={() => pickSuggestion(s)}
                className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate">{s.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Raio */}
      <div>
        <Label className="flex justify-between">
          <span>Raio: <strong className="text-primary">{radius} km</strong></span>
          <span className="text-[10px] text-muted-foreground">{radius <= 1 ? "≈ quarteirão" : radius <= 3 ? "≈ bairro" : radius <= 10 ? "≈ região da cidade" : radius <= 25 ? "≈ cidade inteira" : "≈ região metropolitana"}</span>
        </Label>
        <Slider min={1} max={80} step={1} value={[radius]} onValueChange={(v) => setRadius(v[0])} />
        <div className="flex flex-wrap gap-1 mt-2">
          {[
            { l: "Bairro (3 km)", v: 3 },
            { l: "Região (10 km)", v: 10 },
            { l: "Cidade (25 km)", v: 25 },
            { l: "Metropolitana (50 km)", v: 50 },
            { l: "Máximo (80 km)", v: 80 },
          ].map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setRadius(p.v)}
              className={`text-[10px] px-2 py-1 rounded-full border transition ${radius === p.v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}
            >
              {p.l}
            </button>
          ))}
        </div>
        {radius > 50 && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Para cobertura &gt;80 km (várias cidades vizinhas), prefira o modo <strong>Cidades inteiras</strong>.
          </p>
        )}
      </div>

      {pending && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 p-2">
          <div className="text-xs text-primary truncate">
            <strong>Confirmar:</strong> {pending.address_string} ({radius} km)
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setPending(null); setQuery(""); }}>
              Cancelar
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={confirmPending} disabled={value.length >= 200}>
              Adicionar
            </Button>
          </div>
        </div>
      )}

      {/* Lista de pontos confirmados */}
      {value.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">
            {value.length}/200 ponto(s) selecionado(s)
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {value.map((p, i) => (
              <Badge key={`${p.latitude},${p.longitude},${i}`} variant="secondary" className="gap-1.5 py-1 px-2 text-xs">
                <span className="font-bold text-[10px] opacity-60">{i + 1}.</span>
                <span className="truncate max-w-[220px]">{p.address_string}</span>
                <span className="opacity-60">· {p.radius}km</span>
                <button onClick={() => removePoint(i)} aria-label="Remover">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
