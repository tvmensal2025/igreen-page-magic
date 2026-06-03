// Picker de endereço/raio para segmentação ultra-local (rua, casa do vizinho, bairro).
// Usa Places API (New) via browser autocomplete + Google Maps JS p/ mini-mapa com círculo.
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

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

declare global {
  interface Window {
    google: any;
    __ig_initMaps?: () => void;
  }
}

let mapsLoadPromise: Promise<void> | null = null;
function loadMapsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;
  if (!BROWSER_KEY) return Promise.reject(new Error("Google Maps browser key não configurada."));
  mapsLoadPromise = new Promise((resolve, reject) => {
    window.__ig_initMaps = () => resolve();
    const s = document.createElement("script");
    const channel = TRACKING_ID ? `&channel=${TRACKING_ID}` : "";
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async&libraries=places&callback=__ig_initMaps${channel}`;
    s.async = true;
    s.onerror = () => reject(new Error("Falha ao carregar Google Maps"));
    document.head.appendChild(s);
  });
  return mapsLoadPromise;
}

export function AddressRadiusPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(3);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<RadiusPoint | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const sessionTokenRef = useRef<any>(null);

  useEffect(() => {
    loadMapsApi()
      .then(async () => {
        const { Map } = await window.google.maps.importLibrary("maps");
        if (!mapDivRef.current) return;
        mapRef.current = new Map(mapDivRef.current, {
          center: { lat: -15.78, lng: -47.93 }, // Brasil
          zoom: 4,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
        // Renderiza pontos já existentes
        renderAll();
        setMapReady(true);
      })
      .catch((e) => setMapError(e.message || "Não foi possível carregar o mapa."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (mapReady) renderAll(); /* eslint-disable-next-line */ }, [value, pending, mapReady]);

  function renderAll() {
    if (!mapRef.current || !window.google?.maps) return;
    // Limpa overlays atuais
    (mapRef.current as any).__markers?.forEach((m: any) => m.setMap(null));
    (mapRef.current as any).__circles?.forEach((c: any) => c.setMap(null));
    (mapRef.current as any).__markers = [];
    (mapRef.current as any).__circles = [];
    const bounds = new window.google.maps.LatLngBounds();
    const pts: RadiusPoint[] = [...value, ...(pending ? [pending] : [])];
    pts.forEach((p, idx) => {
      const pos = { lat: p.latitude, lng: p.longitude };
      const m = new window.google.maps.Marker({ position: pos, map: mapRef.current, label: String(idx + 1) });
      const c = new window.google.maps.Circle({
        center: pos, radius: p.radius * 1000, map: mapRef.current,
        strokeColor: pending && idx === pts.length - 1 ? "#22c55e" : "#3b82f6",
        strokeOpacity: 0.8, strokeWeight: 1.5,
        fillColor: pending && idx === pts.length - 1 ? "#22c55e" : "#3b82f6",
        fillOpacity: 0.12,
      });
      (mapRef.current as any).__markers.push(m);
      (mapRef.current as any).__circles.push(c);
      bounds.extend(pos);
      // Estende bounds pelo raio
      const r = p.radius / 111; // km → graus aprox
      bounds.extend({ lat: p.latitude + r, lng: p.longitude + r });
      bounds.extend({ lat: p.latitude - r, lng: p.longitude - r });
    });
    if (pts.length > 0) mapRef.current.fitBounds(bounds, 40);
  }

  useEffect(() => {
    if (!query || query.length < 3) { setSuggestions([]); return; }
    if (!mapReady) return;
    const handle = setTimeout(async () => {
      setLoadingSugg(true);
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } =
          await window.google.maps.importLibrary("places");
        if (!sessionTokenRef.current) sessionTokenRef.current = new AutocompleteSessionToken();
        const { suggestions: s } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ["br"],
        });
        setSuggestions(s || []);
      } catch (e) {
        console.warn("autocomplete falhou", e);
      } finally {
        setLoadingSugg(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, mapReady]);

  async function pickSuggestion(sugg: any) {
    setPicking(true);
    try {
      const place = sugg.placePrediction.toPlace();
      await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
      const loc = place.location;
      const pt: RadiusPoint = {
        latitude: loc.lat(),
        longitude: loc.lng(),
        radius,
        address_string: place.formattedAddress || place.displayName || sugg.placePrediction.text?.text || "",
        name: place.displayName || undefined,
      };
      setPending(pt);
      setQuery(pt.address_string);
      setSuggestions([]);
      // Centraliza no novo ponto
      if (mapRef.current) {
        mapRef.current.setCenter({ lat: pt.latitude, lng: pt.longitude });
        mapRef.current.setZoom(radius <= 2 ? 15 : radius <= 5 ? 13 : radius <= 15 ? 11 : 10);
      }
    } catch (e) {
      console.warn("pick place failed", e);
    } finally {
      setPicking(false);
      sessionTokenRef.current = null;
    }
  }

  function confirmPending() {
    if (!pending) return;
    if (value.length >= 200) return;
    onChange([...value, { ...pending, radius }]);
    setPending(null);
    setQuery("");
  }

  // Atualiza pending.radius enquanto o slider mexe
  useEffect(() => { if (pending) setPending({ ...pending, radius }); /* eslint-disable-next-line */ }, [radius]);

  function removePoint(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  if (!BROWSER_KEY) {
    return (
      <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
        Google Maps não está configurado. Configure o conector Google Maps Platform pra usar segmentação por endereço/raio.
      </div>
    );
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
        {suggestions.length > 0 && (
          <div className="mt-1 border rounded-lg bg-card divide-y max-h-48 overflow-y-auto">
            {suggestions.map((s, i) => {
              const txt = s.placePrediction?.text?.text || "";
              return (
                <button
                  key={i}
                  type="button"
                  disabled={picking}
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">{txt}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Raio */}
      <div>
        <Label className="flex justify-between">
          <span>Raio: <strong className="text-primary">{radius} km</strong></span>
          <span className="text-[10px] text-muted-foreground">{radius <= 1 ? "≈ quarteirão" : radius <= 3 ? "≈ bairro" : radius <= 10 ? "≈ região da cidade" : "≈ cidade inteira"}</span>
        </Label>
        <Slider min={1} max={50} step={1} value={[radius]} onValueChange={(v) => setRadius(v[0])} />
        <div className="flex flex-wrap gap-1 mt-2">
          {[
            { l: "Quarteirão (1 km)", v: 1 },
            { l: "Bairro (3 km)", v: 3 },
            { l: "Região (10 km)", v: 10 },
            { l: "Cidade (25 km)", v: 25 },
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
      </div>

      {/* Mapa */}
      <div className="rounded-lg overflow-hidden border bg-muted">
        {mapError ? (
          <div className="p-4 text-xs text-destructive">{mapError}</div>
        ) : (
          <div ref={mapDivRef} className="w-full h-64" />
        )}
      </div>

      {pending && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
          <div className="text-xs text-emerald-200 truncate">
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
