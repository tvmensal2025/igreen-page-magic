/**
 * AudioStudio — Estúdio de áudio iGreen.
 *
 * Duas variantes:
 *   - Mutirão (cidade, rua, horário, sorteio)
 *   - Comércio (nome do comércio, cidade, endereço, horário)
 *
 * Cada áudio gerado é salvo em `audio_library` (privado) e pode ser publicado
 * para que qualquer consultor reaproveite via busca por cidade.
 *
 * Cache TTS continua em 3 camadas: in-memory → IndexedDB → bucket tts-cache.
 * Áudios reaproveitados da biblioteca pública tocam direto do MP3 já gerado
 * (zero token ElevenLabs).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Volume2, Loader2, Play, Pause, Download,
  RotateCcw, Music, MapPin, Clock, Navigation, Gift,
  Store, Megaphone, History, Globe2, Search, Lock, Upload, Copy, Trash2, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { encodeMp3, decodeAudioBlob, concatWithCrossfade, downloadBlob } from "@/lib/audioProcessing";
import { AudioWhatsAppPopover } from "./AudioWhatsAppPopover";

// ─── ElevenLabs via proxy ─────────────────────────────────────────────────────
const VOICE_ID = "rpNe0HOx7heUulPiOEaG";
const MODEL_ID = "eleven_multilingual_v2";

// ─── Cache TTS ───────────────────────────────────────────────────────────────
const CACHE_VERSION = 6;
const TTS_BUCKET    = "tts-cache";

const cacheMap = new Map<string, Blob>();

function hashText(text: string): string {
  const n = text.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < n.length; i++) { h = ((h << 5) - h) + n.charCodeAt(i); h |= 0; }
  return `v${CACHE_VERSION}_${Math.abs(h)}_${n.length}`;
}

let idbDb: IDBDatabase | null = null;
async function openIDB(): Promise<IDBDatabase> {
  if (idbDb) return idbDb;
  return new Promise((res, rej) => {
    const req = indexedDB.open("tts-cache-igreen", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "hash" });
    };
    req.onsuccess = () => { idbDb = req.result; res(req.result); };
    req.onerror   = () => rej(req.error);
  });
}
async function idbGet(hash: string): Promise<Blob | null> {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction("entries", "readonly");
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
      const tx = db.transaction("entries", "readwrite");
      const req = tx.objectStore("entries").put({ hash, blob });
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch {}
}
async function getCachedTTS(text: string): Promise<Blob | null> {
  const hash = hashText(text);
  if (cacheMap.has(hash)) return cacheMap.get(hash)!;
  const local = await idbGet(hash);
  if (local) { cacheMap.set(hash, local); return local; }
  try {
    const { data, error } = await supabase.storage.from(TTS_BUCKET).download(`${hash}.mp3`);
    if (!error && data && data.size > 0) {
      cacheMap.set(hash, data);
      await idbSet(hash, data);
      return data;
    }
  } catch {}
  return null;
}
async function setCachedTTS(text: string, blob: Blob): Promise<void> {
  const hash = hashText(text);
  cacheMap.set(hash, blob);
  await idbSet(hash, blob);
  supabase.storage.from(TTS_BUCKET)
    .upload(`${hash}.mp3`, blob, { contentType: "audio/mpeg", upsert: true })
    .then(({ error }) => { if (error) console.warn("[tts-cache] upload supabase falhou:", error.message); });
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
  "comercio":"comércio",
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
  if (ABREVIACOES[primeira]) return ABREVIACOES[primeira] + " " + partes.slice(1).join(" ");
  return rua;
}
const UNIDADES  = ["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
const DEZENAS   = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
const CENTENAS  = ["","cem","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
function numeroExtenso(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return "menos " + numeroExtenso(-n);
  if (n < 20) return UNIDADES[n];
  if (n < 100) { const d = Math.floor(n / 10), u = n % 10; return u === 0 ? DEZENAS[d] : `${DEZENAS[d]} e ${UNIDADES[u]}`; }
  if (n < 1000) { const c = Math.floor(n / 100), r = n % 100; if (r === 0) return CENTENAS[c]; const cStr = c === 1 ? "cento" : CENTENAS[c]; return `${cStr} e ${numeroExtenso(r)}`; }
  if (n < 10000) { const m = Math.floor(n / 1000), r = n % 1000; const mStr = m === 1 ? "mil" : `${UNIDADES[m]} mil`; return r === 0 ? mStr : `${mStr} e ${numeroExtenso(r)}`; }
  return String(n);
}
function numeroEnderecoExtenso(input: string): string {
  const n = parseInt((input || "").replace(/\D/g, ""), 10);
  if (isNaN(n) || n <= 0) return "";
  return numeroExtenso(n);
}
function horarioExtenso(h: string): string {
  const n = parseInt(h.replace(/\D/g, ""), 10);
  if (isNaN(n)) return h;
  if (n === 0)  return "meia-noite";
  if (n === 12) return "meio-dia";
  return `${numeroExtenso(n)} ${n === 1 ? "hora" : "horas"}`;
}

// ─── Templates ───────────────────────────────────────────────────────────────
type Kind = "mutirao" | "comercio";
type RefTipo = "proximo" | "em_frente";
type SorteioTipo = "dinheiro" | "vale" | "cesta" | "custom";

const FIXO_MUTIRAO = "Hoje tem mutirão de cadastramento para reduzir o valor da sua conta de luz! É um direito seu! É isso mesmo! É uma iniciativa privada com incentivo do Governo Federal, pela Lei catorze mil e trezentos. Até vinte por cento de desconto todo mês na sua conta de luz! Sem investimento! Sem taxas! É só cadastrar! Quer saber como? Compareça hoje ao mutirão";
const FIXO_COMERCIO = "Hoje tem cadastramento para reduzir o valor da sua conta de luz! É um direito seu! É isso mesmo! É uma iniciativa privada com incentivo do Governo Federal, pela Lei catorze mil e trezentos. Até vinte por cento de desconto todo mês na sua conta de luz! Sem investimento! Sem taxas! É só cadastrar! Quer saber como? Passe hoje no";
const FIXO_FINAL = "Traga: documento pessoal, fatura de energia atualizada e celular em mãos!";

const SORTEIO_KEY = "tts_sorteio_igreen_v1";

function buildSorteioTexto(tipo: SorteioTipo, valor: string, local: string, descricao: string, custom: string, autoCorrecao: boolean): string {
  const fix = autoCorrecao ? corrigirAcentos : (t: string) => t;
  if (tipo === "custom") return fix((custom || "").trim());
  if (tipo === "dinheiro") {
    const ext = numeroEnderecoExtenso(valor);
    return ext ? `E mais! Quem comparecer hoje ainda concorre a um sorteio de ${ext} reais em dinheiro! Não fique de fora!` : "";
  }
  if (tipo === "vale") {
    const ext = numeroEnderecoExtenso(valor);
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

// ─── Tipos da biblioteca ─────────────────────────────────────────────────────
interface AudioRow {
  id: string;
  consultant_id: string;
  kind: Kind;
  city: string;
  street: string;
  time_slot: string;
  place_name: string;
  script_text: string;
  audio_url: string;
  audio_hash: string;
  is_public: boolean;
  play_count: number;
  created_at: string;
}

// ─── Componente principal ────────────────────────────────────────────────────
export function AudioStudio({ userId }: { userId: string }) {
  const { toast } = useToast();
  const { isSuperAdmin } = useUserRole(userId);

  // Tab variante
  const [kind, setKind] = useState<Kind>("mutirao");

  // Form (compartilhado entre as duas variantes)
  const [cidade,     setCidade]     = useState("");
  const [rua,        setRua]        = useState("");
  const [numero,     setNumero]     = useState("");
  const [bairro,     setBairro]     = useState("");
  const [placeName,  setPlaceName]  = useState(""); // só comércio
  const [horaInicio, setHoraInicio] = useState("8");
  const [horaFim,    setHoraFim]    = useState("18");
  const [refTipo,    setRefTipo]    = useState<RefTipo>("proximo");
  const [referencia, setReferencia] = useState("");
  const [autoCorrecao, setAutoCorrecao] = useState(true);

  // Sorteio (só mutirão)
  const [sorteioAtivo,     setSorteioAtivo]     = useState(false);
  const [sorteioTipo,      setSorteioTipo]      = useState<SorteioTipo>("dinheiro");
  const [sorteioValor,     setSorteioValor]     = useState("");
  const [sorteioLocal,     setSorteioLocal]     = useState("");
  const [sorteioDescricao, setSorteioDescricao] = useState("");
  const [sorteioCustom,    setSorteioCustom]    = useState("");

  // Player
  const [generating, setGenerating] = useState(false);
  const [audioUrl,   setAudioUrl]   = useState<string | null>(null);
  const [audioBlob,  setAudioBlob]  = useState<Blob | null>(null);
  const [lastRowId,  setLastRowId]  = useState<string | null>(null);
  const [lastIsPublic, setLastIsPublic] = useState(false);
  const [lastPublicUrl, setLastPublicUrl] = useState<string | null>(null);
  const [playing,    setPlaying]    = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Biblioteca
  const [libTab, setLibTab] = useState<"mine" | "public" | "all">("mine");
  const [librarySearch, setLibrarySearch] = useState("");
  const [myAudios, setMyAudios] = useState<AudioRow[]>([]);
  const [publicAudios, setPublicAudios] = useState<AudioRow[]>([]);
  const [allAudios, setAllAudios] = useState<AudioRow[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

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

  // ─── Texto preview ────────────────────────────────────────────────────────
  const fix = autoCorrecao ? corrigirAcentos : (t: string) => t;
  const cidadeP = fix(cidade.trim());
  let ruaP = fix(expandirEndereco(rua));
  const numExt = numeroEnderecoExtenso(numero);
  if (numExt && ruaP) ruaP = `${ruaP}, número ${numExt}`;
  const bairroP = fix(bairro.trim());
  if (bairroP && ruaP) ruaP = `${ruaP}, no bairro ${bairroP}`;
  const refP = fix(referencia.trim());
  if (refP) ruaP = `${ruaP}, ${refTipo === "proximo" ? "próximo ao" : "em frente ao"} ${refP}`;
  const placeP = fix(placeName.trim());
  const horarioP = `Das ${horarioExtenso(horaInicio || "8")} às ${horarioExtenso(horaFim || "18")}.`;
  const sorteioTexto = kind === "mutirao" && sorteioAtivo
    ? buildSorteioTexto(sorteioTipo, sorteioValor, sorteioLocal, sorteioDescricao, sorteioCustom, autoCorrecao)
    : "";

  let textoPreview = "";
  if (kind === "mutirao") {
    const trecho1 = cidadeP ? `Atenção, moradores e comerciantes de ${cidadeP} e região!` : "Atenção, moradores e comerciantes de [cidade] e região!";
    textoPreview = [trecho1, FIXO_MUTIRAO, `na ${ruaP || "[rua]"}.`, horarioP, FIXO_FINAL, sorteioTexto].filter(Boolean).join(" ");
  } else {
    const trecho1 = cidadeP ? `Atenção, moradores de ${cidadeP} e região!` : "Atenção, moradores de [cidade] e região!";
    const ondeFrag = placeP
      ? `${placeP}${ruaP ? `, localizado na ${ruaP}` : ""}.`
      : (ruaP ? `${ruaP}.` : "[nome do comércio].");
    textoPreview = [trecho1, FIXO_COMERCIO, ondeFrag, horarioP, FIXO_FINAL].filter(Boolean).join(" ");
  }

  // ─── Geração TTS ──────────────────────────────────────────────────────────
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
      body: JSON.stringify({ text, voice_id: VOICE_ID, model_id: MODEL_ID }),
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

  // ─── Biblioteca: load ─────────────────────────────────────────────────────
  const loadLibrary = useCallback(async () => {
    if (!userId) return;
    setLoadingLib(true);
    try {
      const term = librarySearch.trim();
      const tasks: PromiseLike<any>[] = [
        supabase.from("audio_library").select("*").eq("consultant_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(50).then(r => r),
        (() => {
          let q = supabase.from("audio_library").select("*").eq("is_public", true).eq("kind", kind);
          if (term) q = q.ilike("city", `%${term}%`);
          return q.order("play_count", { ascending: false }).order("created_at", { ascending: false }).limit(50).then(r => r);
        })(),
      ];
      if (isSuperAdmin) {
        let qAll = supabase.from("audio_library").select("*").eq("kind", kind);
        if (term && libTab === "all") qAll = qAll.ilike("city", `%${term}%`);
        tasks.push(qAll.order("created_at", { ascending: false }).limit(200).then(r => r));
      }
      const results = await Promise.all(tasks);
      if (results[0]?.data) setMyAudios(results[0].data as AudioRow[]);
      if (results[1]?.data) setPublicAudios(results[1].data as AudioRow[]);
      if (isSuperAdmin && results[2]?.data) setAllAudios(results[2].data as AudioRow[]);
    } finally { setLoadingLib(false); }
  }, [userId, kind, librarySearch, isSuperAdmin, libTab]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  // ─── Geração principal + persistência ─────────────────────────────────────
  const handleGenerate = async () => {
    if (!cidade.trim()) { toast({ title: "Preencha o nome da cidade", variant: "destructive" }); return; }
    if (kind === "mutirao" && !rua.trim()) { toast({ title: "Preencha a rua ou local do mutirão", variant: "destructive" }); return; }
    if (kind === "comercio" && !placeName.trim()) { toast({ title: "Preencha o nome do comércio", variant: "destructive" }); return; }

    setGenerating(true);
    stopAudio();
    try {
      let textos: string[];
      if (kind === "mutirao") {
        const trecho1 = `Atenção, moradores e comerciantes de ${cidadeP} e região!`;
        textos = [trecho1, FIXO_MUTIRAO, `na ${ruaP}.`, horarioP, FIXO_FINAL];
        if (sorteioTexto) textos.push(sorteioTexto);
      } else {
        const trecho1 = `Atenção, moradores de ${cidadeP} e região!`;
        const ondeFrag = `${placeP}${ruaP ? `, localizado na ${ruaP}` : ""}.`;
        textos = [trecho1, FIXO_COMERCIO, ondeFrag, horarioP, FIXO_FINAL];
      }

      const blobs: Blob[] = [];
      for (const t of textos) blobs.push(await getOrGenerate(t));
      const buffers = await Promise.all(blobs.map(decodeAudioBlob));
      const merged  = concatWithCrossfade(buffers, 100);
      const mp3Blob = await encodeMp3(merged, 192);

      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(mp3Blob);
      setAudioUrl(URL.createObjectURL(mp3Blob));

      const row = await saveToLibrary(mp3Blob, textoPreview);
      if (row) { setLastRowId(row.id); setLastIsPublic(false); setLastPublicUrl(row.audio_url); }
      toast({ title: "✅ Áudio gerado e salvo no seu histórico!" });
      loadLibrary();
    } catch (e: any) {
      toast({ title: "Erro ao gerar áudio", description: e.message, variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const saveToLibrary = async (blob: Blob, scriptText: string): Promise<AudioRow | null> => {
    try {
      const path = `${userId}/${kind}-${Date.now()}.mp3`;
      const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, blob, {
        upsert: false, contentType: "audio/mpeg",
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);

      const ruaNome = fix(expandirEndereco(rua)).replace(/^(Rua|Avenida|Alameda|Travessa|Praça|Rodovia|Estrada)\s+/i, "");
      const hora  = `${horaInicio}h-${horaFim}h`;
      const nome  = kind === "mutirao"
        ? `${cidadeP || "áudio"} - ${ruaNome}${bairro.trim() ? ` (${fix(bairro.trim())})` : ""} - ${hora}`
        : `${cidadeP || "áudio"} - ${placeP}${ruaNome ? ` (${ruaNome})` : ""} - ${hora}`;

      // Catálogo de mídia (mantém comportamento atual de aparecer na biblioteca do painel)
      await supabase.from("ai_media_library").insert({
        consultant_id: userId, is_public: false, kind: "audio",
        label: nome, url: pub.publicUrl,
        step_tags: ["any"], intent_tags: [], active: true, priority: 10,
      });

      const { data, error } = await supabase.from("audio_library").insert({
        consultant_id: userId,
        kind,
        city: cidadeP,
        street: ruaP,
        time_slot: hora,
        place_name: placeP,
        script_text: scriptText,
        audio_url: pub.publicUrl,
        audio_hash: hashText(scriptText),
        is_public: false,
      }).select("*").single();
      if (error) throw error;
      return data as AudioRow;
    } catch (e) {
      console.error("[AudioStudio] Erro ao salvar:", e);
      toast({ title: "Áudio gerado mas não foi possível salvar no histórico", variant: "destructive" });
      return null;
    }
  };

  const publishCurrent = async () => {
    if (!lastRowId) return;
    const { error } = await supabase.from("audio_library").update({ is_public: true }).eq("id", lastRowId);
    if (error) { toast({ title: "Erro ao publicar", description: error.message, variant: "destructive" }); return; }
    setLastIsPublic(true);
    toast({ title: "🌎 Publicado na biblioteca pública!" });
    loadLibrary();
  };

  const togglePublishRow = async (row: AudioRow) => {
    const { error } = await supabase.from("audio_library").update({ is_public: !row.is_public }).eq("id", row.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: row.is_public ? "Áudio retirado da biblioteca pública" : "🌎 Publicado!" });
    loadLibrary();
  };

  const deleteRow = async (row: AudioRow) => {
    if (!confirm(`Apagar o áudio de ${row.city}?`)) return;
    const { error } = await supabase.from("audio_library").delete().eq("id", row.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Áudio apagado" });
    loadLibrary();
  };

  const playRowAudio = async (row: AudioRow) => {
    try {
      // Reaproveita o MP3 direto da URL pública — zero token
      const r = await fetch(row.audio_url);
      const blob = await r.blob();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(blob);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setLastRowId(row.consultant_id === userId ? row.id : null);
      setLastIsPublic(row.is_public);
      setLastPublicUrl(row.audio_url);
      const a = audioRef.current || new Audio(url);
      audioRef.current = a; a.src = url;
      a.onended = () => setPlaying(false);
      a.play(); setPlaying(true);
      // incrementa play_count
      supabase.rpc("audio_library_increment_play", { _id: row.id }).then(() => {});
    } catch (e: any) {
      toast({ title: "Erro ao tocar", description: e.message, variant: "destructive" });
    }
  };

  const copyRowUrl = async (row: AudioRow) => {
    try { await navigator.clipboard.writeText(row.audio_url); toast({ title: "Link copiado!" }); }
    catch { toast({ title: "Não foi possível copiar" }); }
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
    const filename = `${kind}_${cidade.trim().toLowerCase().replace(/\s+/g, "_") || "audio"}.mp3`;
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
      const filename = `${kind}_vinheta_${cidade.trim().toLowerCase().replace(/\s+/g, "_") || "audio"}.mp3`;
      downloadBlob(mp3Blob, filename);
      toast({ title: "✅ Áudio com vinheta baixado!" });
    } catch {
      toast({ title: "Erro ao montar áudio com vinheta", variant: "destructive" });
    }
  };

  const kindLabel = kind === "mutirao" ? "Mutirão" : "Comércio";

  return (
    <div className="min-h-full pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Volume2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Estúdio de Áudio</h2>
          <p className="text-xs text-muted-foreground">Gere e reaproveite áudios por cidade — Mutirão ou Comércio</p>
        </div>
      </div>

      {/* Tabs Mutirão / Comércio */}
      <div className="max-w-lg mx-auto grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setKind("mutirao")}
          className={`h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${kind === "mutirao" ? "bg-primary text-primary-foreground shadow" : "bg-card border border-border/50 text-muted-foreground"}`}
        >
          <Megaphone className="w-4 h-4" /> Mutirão
        </button>
        <button
          onClick={() => setKind("comercio")}
          className={`h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${kind === "comercio" ? "bg-primary text-primary-foreground shadow" : "bg-card border border-border/50 text-muted-foreground"}`}
        >
          <Store className="w-4 h-4" /> Comércio
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 max-w-5xl mx-auto">
        {/* ─── Coluna do formulário ─────────────────────────────────────── */}
        <div className="space-y-3 max-w-lg w-full mx-auto lg:mx-0">
          {/* Auto-correção */}
          <div className="flex items-center justify-between bg-card rounded-xl border border-border/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">Correção automática</p>
              <p className="text-[10px] text-muted-foreground">Acentos e abreviações</p>
            </div>
            <button onClick={() => setAutoCorrecao(!autoCorrecao)}
              className={`relative w-11 h-6 rounded-full transition-all duration-300 ${autoCorrecao ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-300 ${autoCorrecao ? "left-[21px]" : "left-0.5"}`} />
            </button>
          </div>

          {/* Nome do comércio (só comércio) */}
          {kind === "comercio" && (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Store className="w-3 h-3" /> Nome do comércio
              </label>
              <Input value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Ex: Padaria Central" className="bg-card border-border/50 h-11 text-base" />
            </div>
          )}

          {/* Cidade */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Cidade
            </label>
            <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Cabreúva" className="bg-card border-border/50 h-11 text-base" />
          </div>

          {/* Rua + Nº */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Navigation className="w-3 h-3" /> {kind === "mutirao" ? "Rua / Local" : "Endereço do comércio"}
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

          {/* Referência — só mutirão */}
          {kind === "mutirao" && (
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
          )}

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

          {/* Preview */}
          <div className="bg-card rounded-xl border border-border/40 p-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Texto que a IA vai falar</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{textoPreview}</p>
          </div>

          {/* Sorteio — só mutirão */}
          {kind === "mutirao" && (
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
          )}

          {/* Botão Gerar */}
          <Button onClick={handleGenerate} disabled={generating} className="w-full h-[52px] text-base font-semibold rounded-xl gap-2" style={{ background: "var(--gradient-green, var(--pe-emerald, #22c55e))" }}>
            {generating
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Gerando áudio…</>
              : <><Volume2 className="w-5 h-5" /> Gerar Áudio de {kindLabel}</>}
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
                  <p className="text-sm font-semibold truncate">{kindLabel} — {cidade || "cidade"}</p>
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

              {lastPublicUrl && (
                <AudioWhatsAppPopover
                  audioUrl={lastPublicUrl}
                  label={`${kindLabel} — ${cidade || "cidade"}`}
                  trigger={
                    <Button variant="outline" className="w-full h-10 text-xs gap-2 rounded-xl">
                      <Send className="w-4 h-4" /> Enviar no WhatsApp
                    </Button>
                  }
                />
              )}

              {lastRowId && (
                <Button
                  onClick={publishCurrent}
                  disabled={lastIsPublic}
                  variant={lastIsPublic ? "secondary" : "default"}
                  className="w-full h-10 text-xs gap-2"
                >
                  {lastIsPublic ? <><Globe2 className="w-4 h-4" /> Publicado na biblioteca</> : <><Upload className="w-4 h-4" /> Publicar para outros consultores</>}
                </Button>
              )}

              <Button variant="ghost" onClick={handleGenerate} disabled={generating} className="w-full h-9 text-xs text-muted-foreground gap-1">
                <RotateCcw className="w-3 h-3" /> Gerar novamente
              </Button>
            </div>
          )}
        </div>

        {/* ─── Coluna do histórico / biblioteca ─────────────────────────── */}
        <aside className="bg-card rounded-xl border border-border/40 p-3 h-fit lg:sticky lg:top-4 space-y-3">
          <div className={`grid ${isSuperAdmin ? "grid-cols-3" : "grid-cols-2"} gap-1.5`}>
            <button
              onClick={() => setLibTab("mine")}
              className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${libTab === "mine" ? "bg-primary text-primary-foreground" : "bg-muted/40 border border-border/40 text-muted-foreground"}`}
            >
              <History className="w-3.5 h-3.5" /> Meus
            </button>
            <button
              onClick={() => setLibTab("public")}
              className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${libTab === "public" ? "bg-primary text-primary-foreground" : "bg-muted/40 border border-border/40 text-muted-foreground"}`}
            >
              <Globe2 className="w-3.5 h-3.5" /> Pública
            </button>
            {isSuperAdmin && (
              <button
                onClick={() => setLibTab("all")}
                className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${libTab === "all" ? "bg-primary text-primary-foreground" : "bg-warning/15 border border-warning/30 text-warning dark:text-warning"}`}
                title="Visível apenas para super admin"
              >
                <Globe2 className="w-3.5 h-3.5" /> Todos
              </button>
            )}
          </div>

          {(libTab === "public" || libTab === "all") && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Buscar por cidade..."
                className="h-9 pl-8 text-xs bg-background border-border/50"
              />
            </div>
          )}

          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {loadingLib && <p className="text-[11px] text-muted-foreground text-center py-4">Carregando…</p>}
            {!loadingLib && libTab === "mine" && myAudios.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4">Nenhum áudio de {kindLabel.toLowerCase()} ainda</p>
            )}
            {!loadingLib && libTab === "public" && publicAudios.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4">Nenhum áudio publicado{librarySearch.trim() ? ` para "${librarySearch}"` : ""}</p>
            )}
            {!loadingLib && libTab === "all" && allAudios.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4">Nenhum áudio gerado{librarySearch.trim() ? ` para "${librarySearch}"` : ""}</p>
            )}

            {(libTab === "mine" ? myAudios : libTab === "public" ? publicAudios : allAudios).map((row) => {
              const isOpen = expandedRowId === row.id;
              const rowLabel = `${row.kind === "comercio" ? "Comércio" : "Mutirão"} — ${row.city || "cidade"}`;
              return (
              <div key={row.id} className="rounded-lg border border-border/40 bg-background/40 p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => {
                      setExpandedRowId(isOpen ? null : row.id);
                      if (!isOpen) {
                        supabase.rpc("audio_library_increment_play", { _id: row.id }).then(() => {});
                      }
                    }}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isOpen ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
                    title={isOpen ? "Recolher" : "Tocar"}
                  >
                    {isOpen ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">
                      {row.city || "—"}
                      {row.is_public && libTab === "mine" && <Globe2 className="inline w-3 h-3 ml-1 text-primary" />}
                      {!row.is_public && libTab === "mine" && <Lock className="inline w-3 h-3 ml-1 text-muted-foreground" />}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {row.kind === "comercio" && row.place_name ? `${row.place_name} · ` : ""}
                      {row.street || "—"} · {row.time_slot}
                    </p>
                    {libTab === "public" && row.play_count > 0 && (
                      <p className="text-[10px] text-primary">▶ {row.play_count}× usado</p>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <audio
                    src={row.audio_url}
                    controls
                    autoPlay
                    preload="metadata"
                    className="w-full h-9"
                  />
                )}

                <div className="flex gap-1 flex-wrap">
                  <AudioWhatsAppPopover
                    audioUrl={row.audio_url}
                    label={rowLabel}
                    trigger={
                      <button className="flex-1 h-7 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center gap-1">
                        <Send className="w-3 h-3" /> WhatsApp
                      </button>
                    }
                  />
                  <button onClick={() => copyRowUrl(row)} className="h-7 px-2 rounded-md bg-muted/50 hover:bg-muted text-[10px] font-medium flex items-center justify-center gap-1" title="Copiar link">
                    <Copy className="w-3 h-3" />
                  </button>
                  {libTab === "mine" && (
                    <>
                      <button onClick={() => togglePublishRow(row)} title={row.is_public ? "Despublicar" : "Publicar"}
                        className="h-7 px-2 rounded-md bg-muted/50 hover:bg-muted text-[10px] font-medium flex items-center justify-center">
                        {row.is_public ? <Lock className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
                      </button>
                      <button onClick={() => deleteRow(row)} title="Apagar"
                        className="h-7 px-2 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive text-[10px] flex items-center justify-center">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
