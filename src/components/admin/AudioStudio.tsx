/**
 * AudioStudio — Estúdio de áudio para mutirão iGreen.
 *
 * Portado fielmente do scanpro-mobile (TextToSpeech.tsx + ttsCache.ts).
 *
 * Fluxo:
 *   1. Consultor preenche: cidade, rua, nº, bairro, horário, referência
 *   2. Template fixo monta o texto completo do mutirão
 *   3. Texto é quebrado em trechos → cada trecho busca cache (IndexedDB → Supabase tts-cache)
 *   4. Trechos sem cache → geram via ElevenLabs → salvam no cache
 *   5. Trechos são concatenados com crossfade → MP3 final
 *   6. MP3 é salvo em ai-agent-media + ai_media_library (biblioteca do painel)
 *   7. Opção de baixar com ou sem vinheta
 */

import { useState, useEffect, useRef } from "react";
import {
  Volume2, Loader2, Play, Pause, Download,
  RotateCcw, Music, MapPin, Clock, Navigation, Gift,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { encodeMp3, decodeAudioBlob, concatWithCrossfade, downloadBlob } from "@/lib/audioProcessing";

// ─── ElevenLabs via proxy (chave fica no servidor, não no frontend) ───────────
const VOICE_ID = "rpNe0HOx7heUulPiOEaG"; // Diego — masculino PT-BR
const MODEL_ID = "eleven_multilingual_v2";

// ─── Cache TTS ───────────────────────────────────────────────────────────────
// Estratégia em 2 camadas: IndexedDB local → Supabase Storage bucket tts-cache
const CACHE_VERSION = 6;
const VERSION_KEY   = "tts_cache_version";
const TTS_BUCKET    = "tts-cache";

interface CachedEntry { text: string; hash: string; blob: Blob; }
const cacheMap = new Map<string, Blob>(); // in-memory L0

function hashText(text: string): string {
  const n = text.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < n.length; i++) { h = ((h << 5) - h) + n.charCodeAt(i); h |= 0; }
  return `v${CACHE_VERSION}_${Math.abs(h)}_${n.length}`;
}

// IndexedDB simples sem Dexie (evita dependência extra no projeto)
let idbDb: IDBDatabase | null = null;
async function openIDB(): Promise<IDBDatabase> {
  if (idbDb) return idbDb;
  return new Promise((res, rej) => {
    const req = indexedDB.open("tts-cache-igreen", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        db.createObjectStore("entries", { keyPath: "hash" });
      }
    };
    req.onsuccess = () => { idbDb = req.result; res(req.result); };
    req.onerror   = () => rej(req.error);
  });
}

async function idbGet(hash: string): Promise<Blob | null> {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx  = db.transaction("entries", "readonly");
      const req = tx.objectStore("entries").get(hash);
      req.onsuccess = () => res(req.result?.blob ?? null);
      req.onerror   = () => res(null);
    });
  } catch { return null; }
}

async function idbSet(hash: string, blob: Blob): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction("entries", "readwrite");
      const req = tx.objectStore("entries").put({ hash, blob });
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch { /* silencioso */ }
}

async function getCachedTTS(text: string): Promise<Blob | null> {
  const hash = hashText(text);
  // L0 — in-memory
  if (cacheMap.has(hash)) { console.debug("[tts-cache] hit L0", hash); return cacheMap.get(hash)!; }
  // L1 — IndexedDB
  const local = await idbGet(hash);
  if (local) { console.debug("[tts-cache] hit L1 (idb)", hash); cacheMap.set(hash, local); return local; }
  // L2 — Supabase Storage (bucket criado via migration; nada de createBucket no client)
  try {
    const { data, error } = await supabase.storage.from(TTS_BUCKET).download(`${hash}.mp3`);
    if (!error && data && data.size > 0) {
      console.debug("[tts-cache] hit L2 (supabase)", hash, data.size, "bytes");
      cacheMap.set(hash, data);
      await idbSet(hash, data);
      return data;
    }
  } catch {}
  console.debug("[tts-cache] MISS — vai gerar via ElevenLabs:", text.slice(0, 60));
  return null;
}

async function setCachedTTS(text: string, blob: Blob): Promise<void> {
  const hash = hashText(text);
  cacheMap.set(hash, blob);
  await idbSet(hash, blob);
  // Sobe para o bucket compartilhado em background (upsert idempotente)
  supabase.storage.from(TTS_BUCKET)
    .upload(`${hash}.mp3`, blob, { contentType: "audio/mpeg", upsert: true })
    .then(({ error }) => {
      if (error) console.warn("[tts-cache] upload supabase falhou:", error.message);
      else console.debug("[tts-cache] salvo L2", hash, blob.size, "bytes");
    });
}

// ─── Helpers de texto ────────────────────────────────────────────────────────
const CORRECOES: Record<string, string> = {
  "mutirao":"mutirão","energia":"energia","tambem":"também","voce":"você",
  "ate":"até","so":"só","nos":"nós","ja":"já","agua":"água","saude":"saúde",
  "reducao":"redução","informacao":"informação","operacao":"operação",
  "praca":"praça","forca":"força","seguranca":"segurança","crianca":"criança",
  "numero":"número","horario":"horário","publico":"público","onibus":"ônibus",
  "america":"América","sao paulo":"São Paulo","goiania":"Goiânia",
  "brasilia":"Brasília","florianopolis":"Florianópolis","curitiba":"Curitiba",
  "jardim":"Jardim","parque":"Parque","vila":"Vila","centro":"Centro",
  "farmacia":"farmácia","rodoviaria":"rodoviária","cemiterio":"cemitério",
  "condominio":"condomínio","edificio":"edifício","ginasio":"ginásio",
};

function corrigirAcentos(texto: string): string {
  if (!texto) return texto;
  let result = texto;
  const lower = result.toLowerCase();
  for (const [sem, com] of Object.entries(CORRECOES)) {
    if (sem.includes(" ")) {
      const re = new RegExp(`\\b${sem}\\b`, "gi");
      if (re.test(lower)) result = result.replace(re, com);
    }
  }
  const words = result.split(/(\s+)/);
  return words.map((w) => {
    if (/^\s+$/.test(w)) return w;
    const k = w.toLowerCase();
    if (CORRECOES[k]) {
      const c = CORRECOES[k];
      if (w === w.toUpperCase() && w.length > 1) return c.toUpperCase();
      if (w[0] === w[0].toUpperCase()) return c.charAt(0).toUpperCase() + c.slice(1);
      return c;
    }
    return w;
  }).join("");
}

const ABREVIACOES: Record<string, string> = {
  "av.":"Avenida","av":"Avenida","r.":"Rua","rua":"Rua",
  "pça.":"Praça","pça":"Praça","praça":"Praça",
  "al.":"Alameda","al":"Alameda","trav.":"Travessa","rod.":"Rodovia","est.":"Estrada",
};

function expandirEndereco(rua: string): string {
  if (!rua.trim()) return rua;
  const partes = rua.trim().split(/\s+/);
  const primeira = partes[0].toLowerCase();
  if (ABREVIACOES[primeira]) {
    return ABREVIACOES[primeira] + " " + partes.slice(1).join(" ");
  }
  return rua;
}

const UNIDADES  = ["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
const DEZENAS   = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
const CENTENAS  = ["","cem","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];

function numeroExtenso(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return "menos " + numeroExtenso(-n);
  if (n < 20) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10), u = n % 10;
    return u === 0 ? DEZENAS[d] : `${DEZENAS[d]} e ${UNIDADES[u]}`;
  }
  if (n < 1000) {
    const c = Math.floor(n / 100), r = n % 100;
    if (r === 0) return CENTENAS[c];
    const cStr = c === 1 ? "cento" : CENTENAS[c];
    return `${cStr} e ${numeroExtenso(r)}`;
  }
  if (n < 10000) {
    const m = Math.floor(n / 1000), r = n % 1000;
    const mStr = m === 1 ? "mil" : `${UNIDADES[m]} mil`;
    return r === 0 ? mStr : `${mStr} e ${numeroExtenso(r)}`;
  }
  return String(n);
}

function numeroEnderecoExtenso(input: string): string {
  const n = parseInt((input || "").replace(/\D/g, ""), 10);
  if (isNaN(n) || n <= 0) return "";
  return numeroExtenso(n);
}

function valorReaisExtenso(input: string): string {
  return numeroEnderecoExtenso(input);
}

function horarioExtenso(h: string): string {
  const n = parseInt(h.replace(/\D/g, ""), 10);
  if (isNaN(n)) return h;
  if (n === 0)  return "meia-noite";
  if (n === 12) return "meio-dia";
  return `${numeroExtenso(n)} ${n === 1 ? "hora" : "horas"}`;
}

// ─── Template do mutirão ─────────────────────────────────────────────────────
type RefTipo = "proximo" | "em_frente";
type SorteioTipo = "dinheiro" | "vale" | "cesta" | "custom";

const FIXO_2 = "Hoje tem mutirão de cadastramento para reduzir o valor da sua conta de luz! É um direito seu! É isso mesmo! É uma iniciativa privada com incentivo do Governo Federal, pela Lei catorze mil e trezentos. Até vinte por cento de desconto todo mês na sua conta de luz! Sem investimento! Sem taxas! É só cadastrar! Quer saber como? Compareça hoje ao mutirão";
const FIXO_3 = "Traga: documento pessoal, fatura de energia atualizada e celular em mãos!";

const SORTEIO_KEY = "tts_sorteio_igreen_v1";

function buildSorteioTexto(
  tipo: SorteioTipo, valor: string, local: string,
  descricao: string, custom: string, autoCorrecao: boolean,
): string {
  const fix = autoCorrecao ? corrigirAcentos : (t: string) => t;
  if (tipo === "custom") return fix((custom || "").trim());
  if (tipo === "dinheiro") {
    const ext = valorReaisExtenso(valor);
    return ext ? `E mais! Quem comparecer hoje ainda concorre a um sorteio de ${ext} reais em dinheiro! Não fique de fora!` : "";
  }
  if (tipo === "vale") {
    const ext = valorReaisExtenso(valor);
    const localTexto = fix((local || "").trim());
    if (!ext) return "";
    return localTexto
      ? `E mais! Quem comparecer hoje ainda concorre a um vale-compras no valor de ${ext} reais para usar no ${localTexto}! Não fique de fora!`
      : `E mais! Quem comparecer hoje ainda concorre a um vale-compras no valor de ${ext} reais! Não fique de fora!`;
  }
  if (tipo === "cesta") {
    const desc = fix((descricao || "").trim());
    return desc
      ? `E mais! Quem comparecer hoje ainda concorre ao sorteio de uma cesta básica completa, ${desc}! Não fique de fora!`
      : `E mais! Quem comparecer hoje ainda concorre ao sorteio de uma cesta básica completa! Não fique de fora!`;
  }
  return "";
}

// ─── Componente principal ────────────────────────────────────────────────────
export function AudioStudio({ userId }: { userId: string }) {
  const { toast } = useToast();

  // Formulário
  const [cidade,     setCidade]     = useState("");
  const [rua,        setRua]        = useState("");
  const [numero,     setNumero]     = useState("");
  const [bairro,     setBairro]     = useState("");
  const [horaInicio, setHoraInicio] = useState("8");
  const [horaFim,    setHoraFim]    = useState("18");
  const [refTipo,    setRefTipo]    = useState<RefTipo>("proximo");
  const [referencia, setReferencia] = useState("");
  const [autoCorrecao, setAutoCorrecao] = useState(true);

  // Sorteio
  const [sorteioAtivo,     setSorteioAtivo]     = useState(false);
  const [sorteioTipo,      setSorteioTipo]      = useState<SorteioTipo>("dinheiro");
  const [sorteioValor,     setSorteioValor]     = useState("");
  const [sorteioLocal,     setSorteioLocal]     = useState("");
  const [sorteioDescricao, setSorteioDescricao] = useState("");
  const [sorteioCustom,    setSorteioCustom]    = useState("");

  // Player / geração
  const [generating, setGenerating] = useState(false);
  const [audioUrl,   setAudioUrl]   = useState<string | null>(null);
  const [audioBlob,  setAudioBlob]  = useState<Blob | null>(null);
  const [playing,    setPlaying]    = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Persistência sorteio
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORTEIO_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.ativo === "boolean") setSorteioAtivo(s.ativo);
        if (s.tipo) setSorteioTipo(s.tipo);
        if (typeof s.valor === "string") setSorteioValor(s.valor);
        if (typeof s.local === "string") setSorteioLocal(s.local);
        if (typeof s.descricao === "string") setSorteioDescricao(s.descricao);
        if (typeof s.custom === "string") setSorteioCustom(s.custom);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SORTEIO_KEY, JSON.stringify({
        ativo: sorteioAtivo, tipo: sorteioTipo, valor: sorteioValor,
        local: sorteioLocal, descricao: sorteioDescricao, custom: sorteioCustom,
      }));
    } catch {}
  }, [sorteioAtivo, sorteioTipo, sorteioValor, sorteioLocal, sorteioDescricao, sorteioCustom]);

  // Texto preview
  const fix = autoCorrecao ? corrigirAcentos : (t: string) => t;
  const cidadeP = fix(cidade.trim());
  let ruaP = fix(expandirEndereco(rua));
  const numExt = numeroEnderecoExtenso(numero);
  if (numExt && ruaP) ruaP = `${ruaP}, número ${numExt}`;
  const bairroP = fix(bairro.trim());
  if (bairroP && ruaP) ruaP = `${ruaP}, no bairro ${bairroP}`;
  const refP = autoCorrecao ? corrigirAcentos(referencia.trim()) : referencia.trim();
  if (refP) ruaP = `${ruaP}, ${refTipo === "proximo" ? "próximo ao" : "em frente ao"} ${refP}`;
  const horarioP = `Das ${horarioExtenso(horaInicio || "8")} às ${horarioExtenso(horaFim || "18")}.`;
  const sorteioTexto = sorteioAtivo
    ? buildSorteioTexto(sorteioTipo, sorteioValor, sorteioLocal, sorteioDescricao, sorteioCustom, autoCorrecao)
    : "";
  const trecho1P = cidadeP ? `Atenção, moradores e comerciantes de ${cidadeP} e região!` : "Atenção, moradores e comerciantes de [cidade] e região!";
  const textoPreview = [trecho1P, FIXO_2, `na ${ruaP || "[rua]"}.`, horarioP, FIXO_3, sorteioTexto].filter(Boolean).join(" ");

  // Gerar via proxy (chave ElevenLabs fica no servidor)
  const ttsGenerate = async (text: string): Promise<Blob> => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tts-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY || "",
      },
      body: JSON.stringify({
        text,
        voice_id: VOICE_ID,
        model_id: MODEL_ID,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Erro ${res.status}: ${res.statusText}`);
    }
    return res.blob();
  };

  const getOrGenerate = async (text: string): Promise<Blob> => {
    const cached = await getCachedTTS(text);
    if (cached) return cached;
    const blob = await ttsGenerate(text);
    await setCachedTTS(text, blob);
    return blob;
  };

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPlaying(false);
  };

  const handleGenerate = async () => {
    if (!cidade.trim()) { toast({ title: "Preencha o nome da cidade", variant: "destructive" }); return; }
    if (!rua.trim())    { toast({ title: "Preencha a rua ou local do mutirão", variant: "destructive" }); return; }

    setGenerating(true);
    stopAudio();

    try {
      const trecho1 = `Atenção, moradores e comerciantes de ${cidadeP} e região!`;
      const textos  = [trecho1, FIXO_2, `na ${ruaP}.`, horarioP, FIXO_3];
      if (sorteioTexto) textos.push(sorteioTexto);

      const blobs: Blob[] = [];
      for (const t of textos) blobs.push(await getOrGenerate(t));

      const buffers = await Promise.all(blobs.map(decodeAudioBlob));
      const merged  = concatWithCrossfade(buffers, 100);
      const mp3Blob = await encodeMp3(merged, 192);

      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(mp3Blob);
      setAudioUrl(URL.createObjectURL(mp3Blob));

      // Salvar automaticamente na biblioteca
      await saveToLibrary(mp3Blob);
      toast({ title: "✅ Áudio gerado e salvo na biblioteca!" });
    } catch (e: any) {
      toast({ title: "Erro ao gerar áudio", description: e.message, variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const saveToLibrary = async (blob: Blob) => {
    try {
      const ruaNome = fix(expandirEndereco(rua)).replace(/^(Rua|Avenida|Alameda|Travessa|Praça|Rodovia|Estrada)\s+/i, "");
      const hora  = `${horaInicio}h-${horaFim}h`;
      const nome  = `${cidadeP || "áudio"} - ${ruaNome}${bairro.trim() ? ` (${fix(bairro.trim())})` : ""} - ${hora}`;
      const path  = `${userId}/tts-mutirao-${Date.now()}.mp3`;

      const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, blob, {
        upsert: false, contentType: "audio/mpeg",
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
      await supabase.from("ai_media_library").insert({
        consultant_id: userId, is_public: false, kind: "audio",
        label: nome, url: pub.publicUrl,
        step_tags: ["any"], intent_tags: [], active: true, priority: 10,
      });
    } catch (e) {
      console.error("[AudioStudio] Erro ao salvar na biblioteca:", e);
    }
  };

  const togglePlay = () => {
    if (!audioUrl) return;
    if (playing && audioRef.current) { audioRef.current.pause(); setPlaying(false); return; }
    const a = audioRef.current || new Audio(audioUrl);
    audioRef.current = a; a.src = audioUrl;
    a.onended = () => setPlaying(false);
    a.play(); setPlaying(true);
  };

  const handleDownload = () => {
    if (!audioBlob) return;
    const filename = `mutirao_${cidade.trim().toLowerCase().replace(/\s+/g, "_") || "audio"}.mp3`;
    downloadBlob(audioBlob, filename);
    toast({ title: "✅ Áudio baixado!" });
  };

  const handleDownloadComVinheta = async () => {
    if (!audioBlob) return;
    try {
      toast({ title: "Montando áudio com vinheta…" });
      const vinhetaRes = await fetch("/audio/vinheta_tenda.mp3");
      const vinhetaBlob = await vinhetaRes.blob();
      const [vinhetaBuf, audioBuf] = await Promise.all([decodeAudioBlob(vinhetaBlob), decodeAudioBlob(audioBlob)]);
      const merged  = concatWithCrossfade([vinhetaBuf, audioBuf], 100);
      const mp3Blob = await encodeMp3(merged, 192);
      const filename = `mutirao_vinheta_${cidade.trim().toLowerCase().replace(/\s+/g, "_") || "audio"}.mp3`;
      downloadBlob(mp3Blob, filename);
      toast({ title: "✅ Áudio com vinheta baixado!" });
    } catch {
      toast({ title: "Erro ao montar áudio com vinheta", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-full pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Volume2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Estúdio de Áudio — Mutirão</h2>
          <p className="text-xs text-muted-foreground">Preencha os dados → IA gera o áudio do mutirão automaticamente</p>
        </div>
      </div>

      <div className="space-y-3 max-w-lg mx-auto">
        {/* Auto-correção */}
        <div className="flex items-center justify-between bg-card rounded-xl border border-border/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Correção automática</p>
            <p className="text-[10px] text-muted-foreground">Acentos e abreviações</p>
          </div>
          <button
            onClick={() => setAutoCorrecao(!autoCorrecao)}
            className={`relative w-11 h-6 rounded-full transition-all duration-300 ${autoCorrecao ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-300 ${autoCorrecao ? "left-[21px]" : "left-0.5"}`} />
          </button>
        </div>

        {/* Cidade */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Cidade
          </label>
          <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Cabreuva" className="bg-card border-border/50 h-11 text-base" />
        </div>

        {/* Rua + Nº */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Navigation className="w-3 h-3" /> Rua / Local
          </label>
          <div className="flex gap-2">
            <Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Ex: Av. das Nações" className="bg-card border-border/50 h-11 text-base flex-1" />
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº" inputMode="numeric" className="bg-card border-border/50 h-11 text-base w-16 text-center" />
          </div>
          {rua.trim() && (
            <p className="text-[10px] text-primary font-medium">
              → {autoCorrecao ? corrigirAcentos(expandirEndereco(rua)) : expandirEndereco(rua)}
              {numero.trim() ? `, nº ${numeroEnderecoExtenso(numero)}` : ""}
            </p>
          )}
        </div>

        {/* Bairro */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Bairro (opcional)
          </label>
          <Input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Ex: Centro, Jardim América..." className="bg-card border-border/50 h-11 text-base" />
        </div>

        {/* Ponto de referência */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Ponto de referência
          </label>
          <div className="flex gap-2">
            {(["proximo", "em_frente"] as RefTipo[]).map((v) => (
              <button key={v} onClick={() => setRefTipo(v)}
                className={`flex-1 h-10 rounded-xl text-xs font-semibold transition-all ${refTipo === v ? "bg-primary text-primary-foreground" : "bg-card border border-border/50 text-muted-foreground"}`}>
                {v === "proximo" ? "Próximo ao" : "Em frente ao"}
              </button>
            ))}
          </div>
          <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex: Mercado Municipal..." className="bg-card border-border/50 h-11 text-base" />
        </div>

        {/* Horários */}
        <div className="grid grid-cols-2 gap-2">
          {([
            { label: "Início", value: horaInicio, set: setHoraInicio },
            { label: "Fim",    value: horaFim,    set: setHoraFim },
          ] as const).map((f) => (
            <div key={f.label} className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" /> {f.label}
              </label>
              <Input value={f.value} onChange={(e) => (f.set as (v: string) => void)(e.target.value)} placeholder={f.label === "Início" ? "8" : "18"} inputMode="numeric" className="bg-card border-border/50 h-11 text-base" />
              <p className="text-[10px] text-muted-foreground">→ {horarioExtenso(f.value || (f.label === "Início" ? "8" : "18"))}</p>
            </div>
          ))}
        </div>

        {/* Preview do texto */}
        <div className="bg-card rounded-xl border border-border/40 p-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Texto que a IA vai falar</p>
          <p className="text-xs text-foreground/80 leading-relaxed">{textoPreview}</p>
        </div>

        {/* Sorteio / Incentivo */}
        <div className="bg-card rounded-xl border border-border/40 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">Sorteio / Incentivo</p>
                <p className="text-[10px] text-muted-foreground">Adiciona no final do áudio</p>
              </div>
            </div>
            <button onClick={() => setSorteioAtivo(!sorteioAtivo)}
              className={`relative w-11 h-6 rounded-full transition-all duration-300 ${sorteioAtivo ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-300 ${sorteioAtivo ? "left-[21px]" : "left-0.5"}`} />
            </button>
          </div>

          {sorteioAtivo && (
            <div className="space-y-3 animate-in fade-in">
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: "dinheiro", label: "Dinheiro" },
                  { id: "vale",     label: "Vale-compras" },
                  { id: "cesta",    label: "Cesta básica" },
                  { id: "custom",   label: "Personalizado" },
                ] as { id: SorteioTipo; label: string }[]).map((opt) => (
                  <button key={opt.id} onClick={() => setSorteioTipo(opt.id)}
                    className={`h-9 rounded-lg text-xs font-semibold transition-all ${sorteioTipo === opt.id ? "bg-primary text-primary-foreground" : "bg-muted/40 border border-border/40 text-muted-foreground"}`}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {sorteioTipo === "dinheiro" && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Valor em reais</label>
                  <Input value={sorteioValor} onChange={(e) => setSorteioValor(e.target.value)} placeholder="Ex: 200" inputMode="numeric" className="bg-background border-border/50 h-11 text-base" />
                </div>
              )}

              {sorteioTipo === "vale" && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Valor em reais</label>
                    <Input value={sorteioValor} onChange={(e) => setSorteioValor(e.target.value)} placeholder="Ex: 100" inputMode="numeric" className="bg-background border-border/50 h-11 text-base" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mercado / Local</label>
                    <Input value={sorteioLocal} onChange={(e) => setSorteioLocal(e.target.value)} placeholder="Ex: Mercado Barateiro" className="bg-background border-border/50 h-11 text-base" />
                  </div>
                </div>
              )}

              {sorteioTipo === "cesta" && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição (opcional)</label>
                  <Input value={sorteioDescricao} onChange={(e) => setSorteioDescricao(e.target.value)} placeholder="Ex: com 10 itens essenciais" className="bg-background border-border/50 h-11 text-base" />
                </div>
              )}

              {sorteioTipo === "custom" && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Texto personalizado</label>
                  <Textarea value={sorteioCustom} onChange={(e) => setSorteioCustom(e.target.value)} placeholder="Escreva exatamente o que a IA deve falar no final…" className="bg-background border-border/50 text-sm min-h-20" />
                </div>
              )}

              {sorteioTexto && (
                <div className="bg-primary/5 rounded-lg border border-primary/20 p-2.5">
                  <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Trecho final do áudio</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{sorteioTexto}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botão Gerar */}
        <Button onClick={handleGenerate} disabled={generating} className="w-full h-[52px] text-base font-semibold rounded-xl gap-2" style={{ background: "var(--gradient-green, var(--pe-emerald, #22c55e))" }}>
          {generating
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Gerando áudio…</>
            : <><Volume2 className="w-5 h-5" /> Gerar Áudio</>}
        </Button>

        {/* Player */}
        {audioUrl && (
          <div className="bg-card rounded-xl border border-border/40 p-3 space-y-3 animate-in fade-in">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shrink-0 ${playing ? "bg-primary text-primary-foreground shadow-lg" : "bg-primary/10 text-primary"}`}>
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">Mutirão — {cidade || "cidade"}</p>
                <p className="text-[10px] text-muted-foreground">Voz Diego · Toque para ouvir</p>
              </div>
              <button onClick={stopAudio} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/50 shrink-0">
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleDownload} className="h-10 font-semibold text-xs rounded-xl gap-1">
                <Download className="w-4 h-4" /> Baixar MP3
              </Button>
              <Button onClick={handleDownloadComVinheta} variant="secondary" className="h-10 font-semibold text-xs rounded-xl gap-1">
                <Music className="w-4 h-4" /> Com vinheta
              </Button>
            </div>

            <Button variant="ghost" onClick={handleGenerate} disabled={generating} className="w-full h-9 text-xs text-muted-foreground gap-1">
              <RotateCcw className="w-3 h-3" /> Gerar novamente
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
