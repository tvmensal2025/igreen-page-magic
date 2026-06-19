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
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useUserRole } from "@/hooks/useUserRole";
import { encodeMp3, decodeAudioBlob, concatWithCrossfade, downloadBlob } from "@/lib/audioProcessing";
import { AudioWhatsAppPopover } from "./AudioWhatsAppPopover";
import { uploadMedia } from "@/services/minioUpload";

// ─── ElevenLabs via proxy ─────────────────────────────────────────────────────
const VOICE_ID = "rpNe0HOx7heUulPiOEaG";
const MODEL_ID = "eleven_multilingual_v2";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

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
async function idbDelete(hash: string): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((res) => {
      const tx = db.transaction("entries", "readwrite");
      const req = tx.objectStore("entries").delete(hash);
      req.onsuccess = () => res();
      req.onerror   = () => res();
    });
  } catch {}
}
// Valida que o blob é realmente um MP3 (magic bytes "ID3" ou frame sync 0xFFEx).
async function isValidMp3(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 32) return false;
  try {
    const buf = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // "ID3" tag
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
    // MPEG frame sync: 11 bits set (0xFF followed by 0xEx/0xFx)
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
    return false;
  } catch { return false; }
}
export async function purgeCachedTTS(text: string): Promise<void> {
  const hash = hashText(text);
  cacheMap.delete(hash);
  await idbDelete(hash);
}
async function getCachedTTS(text: string): Promise<Blob | null> {
  const hash = hashText(text);
  if (cacheMap.has(hash)) {
    const b = cacheMap.get(hash)!;
    if (await isValidMp3(b)) return b;
    cacheMap.delete(hash); await idbDelete(hash);
  }
  const local = await idbGet(hash);
  if (local) {
    if (await isValidMp3(local)) { cacheMap.set(hash, local); return local; }
    await idbDelete(hash);
  }
  // Cache miss no bucket é esperado (objeto ainda não existe). Usamos a API
  // pública via fetch para evitar que o SDK logue erros no console.
  try {
    const { data: pub } = supabase.storage.from(TTS_BUCKET).getPublicUrl(`${hash}.mp3`);
    if (pub?.publicUrl) {
      const r = await fetch(pub.publicUrl, { cache: "no-store" });
      if (r.ok) {
        const blob = await r.blob();
        if (await isValidMp3(blob)) {
          cacheMap.set(hash, blob);
          await idbSet(hash, blob);
          return blob;
        }
      }
    }
  } catch {}
  return null;
}
async function setCachedTTS(text: string, blob: Blob): Promise<void> {
  const hash = hashText(text);
  if (!(await isValidMp3(blob))) {
    console.warn("[tts-cache] blob inválido, não vou cachear");
    return;
  }
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
  "av.":"Avenida","av":"Avenida","avenida":"Avenida",
  "r.":"Rua","rua":"Rua",
  "pça.":"Praça","pça":"Praça","praca":"Praça","praça":"Praça",
  "al.":"Alameda","al":"Alameda","alameda":"Alameda",
  "trav.":"Travessa","trav":"Travessa","travessa":"Travessa",
  "rod.":"Rodovia","rod":"Rodovia","rodovia":"Rodovia",
  "est.":"Estrada","est":"Estrada","estrada":"Estrada",
  "lgo.":"Largo","lgo":"Largo","largo":"Largo",
  "pq.":"Parque","pq":"Parque","parque":"Parque",
  "rot.":"Rotatória","rot":"Rotatória","rotatoria":"Rotatória","rotatória":"Rotatória",
  "vl.":"Vila","vl":"Vila","vila":"Vila",
  "jd.":"Jardim","jd":"Jardim","jardim":"Jardim",
};
function expandirEndereco(rua: string): string {
  if (!rua.trim()) return rua;
  const partes = rua.trim().split(/\s+/);
  const primeiraNorm = partes[0].toLowerCase().replace(/[.,;:!?]+$/, "");
  if (ABREVIACOES[primeiraNorm]) {
    return ABREVIACOES[primeiraNorm] + (partes.length > 1 ? " " + partes.slice(1).join(" ") : "");
  }
  return rua;
}

// ─── Concordância de gênero (ao/à, no/na) ─────────────────────────────────────
// Resolve o problema de frases como "em frente ao Praça" (errado) → "em frente
// à Praça", ou "Passe hoje no Padaria" (errado) → "Passe hoje na Padaria".
// A heurística olha a primeira palavra do nome: usa uma lista de palavras com
// gênero conhecido e, no que não estiver na lista, cai na regra "termina em A =
// feminino". Assim acerta os casos comuns de pontos de referência e comércios.
const GENERO_PALAVRAS: Record<string, "m" | "f"> = {
  // Femininos (inclusive os que poderiam enganar)
  "praça": "f", "praca": "f", "padaria": "f", "farmácia": "f", "farmacia": "f",
  "escola": "f", "igreja": "f", "capela": "f", "matriz": "f", "paróquia": "f", "paroquia": "f",
  "lanchonete": "f", "lotérica": "f", "loterica": "f", "academia": "f", "feira": "f",
  "quadra": "f", "rodoviária": "f", "rodoviaria": "f", "avenida": "f", "rua": "f",
  "alameda": "f", "travessa": "f", "estrada": "f", "creche": "f", "unidade": "f",
  "prefeitura": "f", "câmara": "f", "camara": "f", "biblioteca": "f", "estação": "f", "estacao": "f",
  "ótica": "f", "otica": "f", "hamburgueria": "f", "pizzaria": "f", "sorveteria": "f",
  "barbearia": "f", "papelaria": "f", "drogaria": "f", "loja": "f", "banca": "f",
  // Masculinos (inclusive os terminados em A ou ambíguos)
  "mercado": "m", "supermercado": "m", "mercadinho": "m", "minimercado": "m",
  "posto": "m", "banco": "m", "colégio": "m", "colegio": "m", "ginásio": "m", "ginasio": "m",
  "shopping": "m", "centro": "m", "terminal": "m", "largo": "m", "parque": "m",
  "campo": "m", "clube": "m", "hospital": "m", "açougue": "m", "acougue": "m",
  "bar": "m", "restaurante": "m", "armazém": "m", "armazem": "m", "comércio": "m", "comercio": "m",
  "salão": "m", "salao": "m", "cemitério": "m", "cemiterio": "m", "templo": "m",
  "cinema": "m", "spa": "m", "hortifruti": "m", "sacolão": "m", "sacolao": "m",
  "depósito": "m", "deposito": "m", "estádio": "m", "estadio": "m",
};
function generoPalavra(nome: string): "m" | "f" {
  const primeira = (nome.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[.,;:!?]/g, "");
  if (GENERO_PALAVRAS[primeira]) return GENERO_PALAVRAS[primeira];
  if (/(ção|são|agem|dade|tude)$/.test(primeira)) return "f";
  if (/a$/.test(primeira)) return "f";
  return "m";
}
// preposição "a" + artigo → "à" (feminino) / "ao" (masculino)
function contraiA(nome: string): string {
  return generoPalavra(nome) === "f" ? "à" : "ao";
}
// preposição "em" + artigo → "na" (feminino) / "no" (masculino)
function contraiEm(nome: string): string {
  return generoPalavra(nome) === "f" ? "na" : "no";
}
// concorda "localizado/localizada" com o gênero do comércio
function localizadoConcordado(nome: string): string {
  return generoPalavra(nome) === "f" ? "localizada" : "localizado";
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
function parseHorario(input: string): { horas: number; minutos: number } | null {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  const withSep = raw.match(/^(\d{1,2})\s*(?::|h|\.)\s*(\d{1,2})?$/);
  if (withSep) {
    const horas = Number(withSep[1]);
    const minutos = Number(withSep[2] || 0);
    return horas >= 0 && horas <= 23 && minutos >= 0 && minutos <= 59 ? { horas, minutos } : null;
  }
  if (/^\d{1,4}$/.test(raw)) {
    if (raw.length <= 2) {
      const horas = Number(raw);
      return horas >= 0 && horas <= 23 ? { horas, minutos: 0 } : null;
    }
    const horas = Number(raw.slice(0, raw.length - 2));
    const minutos = Number(raw.slice(-2));
    return horas >= 0 && horas <= 23 && minutos >= 0 && minutos <= 59 ? { horas, minutos } : null;
  }
  return null;
}
function horarioExtenso(h: string): string {
  const parsed = parseHorario(h);
  if (!parsed) return h;
  const { horas, minutos } = parsed;
  if (horas === 0 && minutos === 0) return "meia-noite";
  if (horas === 12 && minutos === 0) return "meio-dia";
  const horasTexto = `${numeroExtenso(horas)} ${horas === 1 ? "hora" : "horas"}`;
  if (minutos === 0) return horasTexto;
  return `${horasTexto} e ${numeroExtenso(minutos)} ${minutos === 1 ? "minuto" : "minutos"}`;
}
function horarioCurto(h: string): string {
  const parsed = parseHorario(h);
  if (!parsed) return h.trim();
  return parsed.minutos === 0
    ? `${parsed.horas}h`
    : `${String(parsed.horas).padStart(2, "0")}:${String(parsed.minutos).padStart(2, "0")}`;
}

// ─── Templates ───────────────────────────────────────────────────────────────
type Kind = "mutirao" | "comercio";
type RefTipo = "proximo" | "em_frente";
type SorteioTipo = "dinheiro" | "vale" | "cesta" | "custom";

const FIXO_MUTIRAO = "Hoje tem mutirão de cadastramento para reduzir o valor da sua conta de luz! É um direito seu! É isso mesmo! É uma iniciativa privada com incentivo do Governo Federal, pela Lei catorze mil e trezentos. Até vinte por cento de desconto todo mês na sua conta de luz! Sem investimento! Sem taxas! É só cadastrar! Quer saber como? Compareça hoje ao mutirão";
const FIXO_COMERCIO = "Hoje tem cadastramento para reduzir o valor da sua conta de luz! É um direito seu! É isso mesmo! É uma iniciativa privada com incentivo do Governo Federal, pela Lei catorze mil e trezentos. Até vinte por cento de desconto todo mês na sua conta de luz! Sem investimento! Sem taxas! É só cadastrar! Quer saber como? Passe hoje";
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
  audio_url_vinheta: string | null;
  audio_hash: string;
  is_public: boolean;
  play_count: number;
  created_at: string;
}

// ─── Componente principal ────────────────────────────────────────────────────
export function AudioStudio({ userId }: { userId: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
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
  const [audioBlobVinheta, setAudioBlobVinheta] = useState<Blob | null>(null);
  const [lastRowId,  setLastRowId]  = useState<string | null>(null);
  const [lastIsPublic, setLastIsPublic] = useState(false);
  const [lastPublicUrl, setLastPublicUrl] = useState<string | null>(null);
  const [lastPublicUrlVinheta, setLastPublicUrlVinheta] = useState<string | null>(null);
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
  if (refP) {
    const prep = refTipo === "proximo" ? "próximo" : "em frente";
    ruaP = `${ruaP}, ${prep} ${contraiA(refP)} ${refP}`;
  }
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
      ? `${contraiEm(placeP)} ${placeP}${ruaP ? `, ${localizadoConcordado(placeP)} na ${ruaP}` : ""}.`
      : (ruaP ? `na ${ruaP}.` : "[nome do comércio].");
    textoPreview = [trecho1, FIXO_COMERCIO, ondeFrag, horarioP, FIXO_FINAL].filter(Boolean).join(" ");
  }

  // ─── Geração TTS ──────────────────────────────────────────────────────────
  const ttsGenerate = async (text: string): Promise<Blob> => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey": SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ text, voice_id: VOICE_ID, model_id: MODEL_ID }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Erro ${res.status}: ${res.statusText}`);
    }
    const blob = await res.blob();
    if (!(await isValidMp3(blob))) {
      const detail = await blob.text().catch(() => "");
      throw new Error(detail || "Resposta do TTS não veio em MP3 válido");
    }
    return blob;
  };

  const getOrGenerate = async (text: string): Promise<Blob> => {
    const cached = await getCachedTTS(text);
    if (cached) return cached;
    const blob = await ttsGenerate(text);
    await setCachedTTS(text, blob);
    return blob;
  };

  // Cache da vinheta em memória — evita refetch a cada geração/download.
  const vinhetaCacheRef = useRef<Blob | null>(null);

  const fetchVinhetaBlob = async (): Promise<Blob | null> => {
    if (vinhetaCacheRef.current) return vinhetaCacheRef.current;
    const vinhetaRes = await fetch("/audio/vinheta_tenda.mp3");
    if (!vinhetaRes.ok) {
      console.warn("[AudioStudio] Vinheta indisponível:", vinhetaRes.status, vinhetaRes.statusText);
      return null;
    }
    const vinhetaBlob = await vinhetaRes.blob();
    if (!vinhetaBlob || vinhetaBlob.size === 0) {
      console.warn("[AudioStudio] Vinheta vazia ou inválida");
      return null;
    }
    vinhetaCacheRef.current = vinhetaBlob;
    return vinhetaBlob;
  };

  // Monta o áudio com a vinheta no início. Se a vinheta não estiver disponível
  // (arquivo ausente no servidor), devolve null — o fluxo segue só com a versão
  // sem vinheta, sem quebrar a geração.
  const montarComVinheta = async (baseBlob: Blob): Promise<Blob | null> => {
    try {
      const vinhetaBlob = await fetchVinhetaBlob();
      if (!vinhetaBlob) return null;
      const [vinhetaBuf, audioBuf] = await Promise.all([
        decodeAudioBlob(vinhetaBlob), decodeAudioBlob(baseBlob),
      ]);
      const merged = concatWithCrossfade([vinhetaBuf, audioBuf], 100);
      return await encodeMp3(merged, 192);
    } catch (e) {
      console.warn("[AudioStudio] Erro ao montar áudio com vinheta:", e);
      return null;
    }
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

  // ─── Reaproveitamento por hash (dedup do roteiro completo) ─────────────────
  // Aplica um áudio já existente no player, sem gastar token nem remontar MP3.
  const applyReusedRow = async (row: AudioRow): Promise<boolean> => {
    const r = await fetch(row.audio_url);
    if (!r.ok) return false;
    const blob = await r.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(blob);
    setAudioUrl(URL.createObjectURL(blob));
    setAudioBlobVinheta(null);
    setLastRowId(row.consultant_id === userId ? row.id : null);
    setLastIsPublic(row.is_public);
    setLastPublicUrl(row.audio_url);
    setLastPublicUrlVinheta(row.audio_url_vinheta);
    return true;
  };

  // Se o roteiro EXATO (mesmo hash) já existe, reaproveita o MP3 pronto.
  // 1º procura no histórico do próprio consultor; 2º em áudios públicos.
  const tryReuseExisting = async (fullHash: string): Promise<boolean> => {
    try {
      const own = await supabase
        .from("audio_library").select("*")
        .eq("consultant_id", userId).eq("kind", kind).eq("audio_hash", fullHash)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (own.data) {
        const ok = await applyReusedRow(own.data as AudioRow);
        if (ok) {
          toast({ title: "♻️ Áudio reaproveitado — zero tokens!", description: "Roteiro idêntico já estava no seu histórico." });
          return true;
        }
      }

      const pub = await supabase
        .from("audio_library").select("*")
        .eq("is_public", true).eq("kind", kind).eq("audio_hash", fullHash)
        .order("play_count", { ascending: false }).limit(1).maybeSingle();
      if (pub.data) {
        const src = pub.data as AudioRow;
        // Grava no histórico do consultor reusando o MP3 já existente (0 token, 0 upload).
        const { data: inserted } = await supabase.from("audio_library").insert({
          consultant_id: userId,
          kind,
          city: cidadeP,
          street: ruaP,
          time_slot: `${horarioCurto(horaInicio)}-${horarioCurto(horaFim)}`,
          place_name: placeP,
          script_text: textoPreview,
          audio_url: src.audio_url,
          audio_url_vinheta: src.audio_url_vinheta,
          audio_hash: fullHash,
          is_public: false,
        }).select("*").single();
        const ok = await applyReusedRow((inserted as AudioRow) || src);
        if (ok) {
          toast({ title: "♻️ Áudio reaproveitado — zero tokens!", description: "Roteiro idêntico já existia na biblioteca pública." });
          loadLibrary();
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  // ─── Geração principal + persistência ─────────────────────────────────────
  const handleGenerate = async () => {
    if (!cidade.trim()) { toast({ title: "Preencha o nome da cidade", variant: "destructive" }); return; }
    if (kind === "mutirao" && !rua.trim()) { toast({ title: "Preencha a rua ou local do mutirão", variant: "destructive" }); return; }
    if (kind === "comercio" && !placeName.trim()) { toast({ title: "Preencha o nome do comércio", variant: "destructive" }); return; }

    setGenerating(true);
    stopAudio();
    try {
      // Dedup: roteiro EXATO já existe? reaproveita o MP3 pronto (0 token, 0 remontagem).
      if (await tryReuseExisting(hashText(textoPreview))) return;

      // Gera o roteiro completo em uma única chamada. Isso evita o erro do
      // navegador ao decodificar vários MP3s para juntar os trechos.
      const mp3Blob = await getOrGenerate(textoPreview);

      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(mp3Blob);
      setAudioUrl(URL.createObjectURL(mp3Blob));

      // Gera também a versão COM vinheta (se a vinheta estiver disponível) para
      // salvar as duas no histórico de uma vez.
      const vinhetaBlob = await montarComVinheta(mp3Blob);
      setAudioBlobVinheta(vinhetaBlob);

      const row = await saveToLibrary(mp3Blob, textoPreview, vinhetaBlob);
      if (row) {
        setLastRowId(row.id);
        setLastIsPublic(false);
        setLastPublicUrl(row.audio_url);
        setLastPublicUrlVinheta(row.audio_url_vinheta);
      }
      toast({
        title: vinhetaBlob
          ? "✅ Áudio salvo com e sem vinheta!"
          : "✅ Áudio gerado (sem vinheta)",
        description: vinhetaBlob
          ? undefined
          : "Arquivo de vinheta não encontrado — apenas a versão sem vinheta foi salva.",
      });
      loadLibrary();
    } catch (e: any) {
      toast({ title: "Erro ao gerar áudio", description: e.message, variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const saveToLibrary = async (blob: Blob, scriptText: string, vinhetaBlob?: Blob | null): Promise<AudioRow | null> => {
    try {
      const uploadAudio = async (audio: Blob, suffix: string): Promise<string> => {
        const slug = `${kind}-${cidadeP || "audio"}-${horarioCurto(horaInicio)}-${horarioCurto(horaFim)}-${suffix}`;
        const file = new File([audio], `${slug}.mp3`, { type: "audio/mpeg" });
        try {
          const result = await uploadMedia(file, undefined, {
            scope: "admin",
            consultant_id: userId,
            kind: "audio",
            slug,
          });
          return result.url;
        } catch (uploadErr) {
          console.warn("[AudioStudio] Upload MinIO falhou; usando fallback Supabase Storage:", uploadErr);
          const path = `${userId}/${slug}-${Date.now()}.mp3`;
          const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, audio, {
            upsert: false, contentType: "audio/mpeg",
          });
          if (upErr) throw upErr;
          return supabase.storage.from("ai-agent-media").getPublicUrl(path).data.publicUrl;
        }
      };

      const audioPublicUrl = await uploadAudio(blob, "sem-vinheta");

      // Sobe também a versão com vinheta (quando existir).
      let vinhetaUrl: string | null = null;
      if (vinhetaBlob && vinhetaBlob.size > 0) {
        vinhetaUrl = await uploadAudio(vinhetaBlob, "com-vinheta").catch((err) => {
          console.warn("[AudioStudio] Erro ao salvar versão com vinheta:", err);
          return null;
        });
      }

      const ruaNome = fix(expandirEndereco(rua)).replace(/^(Rua|Avenida|Alameda|Travessa|Praça|Rodovia|Estrada)\s+/i, "");
      const hora  = `${horarioCurto(horaInicio)}-${horarioCurto(horaFim)}`;
      const nome  = kind === "mutirao"
        ? `${cidadeP || "áudio"} - ${ruaNome}${bairro.trim() ? ` (${fix(bairro.trim())})` : ""} - ${hora}`
        : `${cidadeP || "áudio"} - ${placeP}${ruaNome ? ` (${ruaNome})` : ""} - ${hora}`;

      // Catálogo de mídia (mantém comportamento atual de aparecer na biblioteca do painel)
      await supabase.from("ai_media_library").insert({
        consultant_id: userId, is_public: false, kind: "audio",
        label: nome, url: audioPublicUrl,
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
        audio_url: audioPublicUrl,
        audio_url_vinheta: vinhetaUrl,
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
    const ok = await confirm({
      title: `Apagar o áudio de ${row.city}?`,
      description: "Esta ação não pode ser desfeita.",
      confirmText: "Apagar",
      tone: "danger",
    });
    if (!ok) return;
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
      setLastPublicUrlVinheta(row.audio_url_vinheta);
      setAudioBlobVinheta(null);
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

  // Pequena pausa entre múltiplos saves do navegador (alguns bloqueiam downloads
  // simultâneos). Disparamos as duas versões em sequência.
  const triggerDualDownload = async (semBlob: Blob, comBlob: Blob | null) => {
    const slug = cidade.trim().toLowerCase().replace(/\s+/g, "_") || "audio";
    downloadBlob(semBlob, `${kind}_${slug}_sem-vinheta.mp3`);
    if (comBlob) {
      await new Promise((r) => setTimeout(r, 400));
      downloadBlob(comBlob, `${kind}_${slug}_com-vinheta.mp3`);
    }
  };

  const handleDownload = async () => {
    if (!audioBlob) return;
    try {
      let comBlob = audioBlobVinheta;
      if (!comBlob) {
        toast({ title: "Montando versão com vinheta…" });
        comBlob = await montarComVinheta(audioBlob);
        if (comBlob) setAudioBlobVinheta(comBlob);
      }
      await triggerDualDownload(audioBlob, comBlob);
      toast({
        title: comBlob
          ? "✅ Baixados: com e sem vinheta"
          : "✅ Áudio baixado (vinheta indisponível)",
      });
    } catch {
      toast({ title: "Erro ao baixar os áudios", variant: "destructive" });
    }
  };

  const kindLabel = kind === "mutirao" ? "Mutirão" : "Comércio";

  return (
    <div
      className="min-h-full pb-12"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ─── Header tipo "console" ─────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-3xl border border-border/50 bg-card mb-6 shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4 p-5 sm:p-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Volume2 className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-0.5">
              iGreen · Studio
            </p>
            <h1
              className="text-2xl sm:text-3xl font-bold text-foreground leading-tight tracking-tight"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontStretch: "95%" }}
            >
              Estúdio de Áudio
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Gere, ouça e distribua áudios por cidade — toda geração já fica salva com e sem vinheta.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Voz Diego
            </span>
            <span className="px-2.5 py-1 rounded-full bg-muted/40 border border-border/40">
              ElevenLabs · Multilingual v2
            </span>
          </div>
        </div>

        <div className="relative border-t border-border/50 px-3 sm:px-4 pt-3 pb-3 flex gap-2">
          {([
            { id: "mutirao", label: "Mutirão", icon: Megaphone },
            { id: "comercio", label: "Comércio", icon: Store },
          ] as { id: Kind; label: string; icon: typeof Megaphone }[]).map((t) => {
            const Icon = t.icon;
            const active = kind === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setKind(t.id)}
                className={`flex-1 sm:flex-none sm:min-w-[160px] h-11 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "bg-muted/30 border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30"
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── Layout split-screen ────────────────────────────────────── */}
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
        {/* ═══ LADO ESQUERDO — formulário ═══ */}
        <section className="space-y-3">
          <SectionTitle icon={Navigation} label="Roteiro" hint="Preencha os dados do anúncio" />

          <div className="bg-card rounded-2xl border border-border/50 p-4 space-y-3 shadow-sm">
            {kind === "comercio" && (
              <Field icon={Store} label="Nome do comércio">
                <Input value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Ex: Padaria Central" className="bg-background border-border/60 h-11 text-base" />
              </Field>
            )}
            <Field icon={MapPin} label="Cidade">
              <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Cabreúva" className="bg-background border-border/60 h-11 text-base" />
            </Field>
            <Field icon={Navigation} label={kind === "mutirao" ? "Rua / local" : "Endereço do comércio"}>
              <div className="flex gap-2">
                <Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Ex: Av. das Nações" className="bg-background border-border/60 h-11 text-base flex-1" />
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº" inputMode="numeric" className="bg-background border-border/60 h-11 text-base w-20 text-center font-mono" />
              </div>
              {rua.trim() && (
                <p className="text-[11px] text-primary font-medium mt-1.5">
                  → {autoCorrecao ? corrigirAcentos(expandirEndereco(rua)) : expandirEndereco(rua)}
                  {numero.trim() ? `, nº ${numeroEnderecoExtenso(numero)}` : ""}
                </p>
              )}
            </Field>
            <Field icon={MapPin} label="Bairro (opcional)">
              <Input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Ex: Centro, Jardim América..." className="bg-background border-border/60 h-11 text-base" />
            </Field>
            {kind === "mutirao" && (
              <Field icon={MapPin} label="Ponto de referência">
                <div className="flex gap-2 mb-2">
                  {(["proximo", "em_frente"] as RefTipo[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setRefTipo(v)}
                      className={`flex-1 h-10 rounded-xl text-xs font-semibold transition-all ${
                        refTipo === v
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/30 border border-border/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v === "proximo" ? "Próximo ao" : "Em frente ao"}
                    </button>
                  ))}
                </div>
                <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex: Mercado Municipal..." className="bg-background border-border/60 h-11 text-base" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              {([
                { label: "Início", value: horaInicio, set: setHoraInicio, ph: "8" },
                { label: "Fim", value: horaFim, set: setHoraFim, ph: "18" },
              ] as const).map((f) => (
                <Field key={f.label} icon={Clock} label={f.label}>
                  <Input
                    value={f.value}
                    onChange={(e) => (f.set as (v: string) => void)(e.target.value)}
                    placeholder={`${f.ph} ou ${String(f.ph).padStart(2, "0")}:00`}
                    inputMode="text"
                    className="bg-background border-border/60 h-11 text-base font-mono text-center"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">→ {horarioExtenso(f.value || f.ph)}</p>
                </Field>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <div>
                <p className="text-xs font-semibold text-foreground">Correção automática</p>
                <p className="text-[10px] text-muted-foreground">Acentos e abreviações</p>
              </div>
              <Toggle on={autoCorrecao} onChange={() => setAutoCorrecao(!autoCorrecao)} />
            </div>
          </div>

          {kind === "mutirao" && (
            <div className="bg-card rounded-2xl border border-border/50 p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Gift className="w-4 h-4 text-primary" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Sorteio / Incentivo</p>
                    <p className="text-[10px] text-muted-foreground">Adicionado no final do áudio</p>
                  </div>
                </div>
                <Toggle on={sorteioAtivo} onChange={() => setSorteioAtivo(!sorteioAtivo)} />
              </div>

              {sorteioAtivo && (
                <div className="space-y-3 animate-in fade-in pt-2 border-t border-border/40">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {([
                      { id: "dinheiro", label: "Dinheiro" },
                      { id: "vale", label: "Vale" },
                      { id: "cesta", label: "Cesta" },
                      { id: "custom", label: "Custom" },
                    ] as { id: SorteioTipo; label: string }[]).map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSorteioTipo(opt.id)}
                        className={`h-9 rounded-lg text-xs font-semibold transition-all ${
                          sorteioTipo === opt.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/30 border border-border/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {sorteioTipo === "dinheiro" && (
                    <Field label="Valor em reais">
                      <Input value={sorteioValor} onChange={(e) => setSorteioValor(e.target.value)} placeholder="Ex: 200" inputMode="numeric" className="bg-background border-border/60 h-11 text-base" />
                    </Field>
                  )}
                  {sorteioTipo === "vale" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Valor (R$)">
                        <Input value={sorteioValor} onChange={(e) => setSorteioValor(e.target.value)} placeholder="100" inputMode="numeric" className="bg-background border-border/60 h-11 text-base" />
                      </Field>
                      <Field label="Mercado / local">
                        <Input value={sorteioLocal} onChange={(e) => setSorteioLocal(e.target.value)} placeholder="Mercado Barateiro" className="bg-background border-border/60 h-11 text-base" />
                      </Field>
                    </div>
                  )}
                  {sorteioTipo === "cesta" && (
                    <Field label="Descrição (opcional)">
                      <Input value={sorteioDescricao} onChange={(e) => setSorteioDescricao(e.target.value)} placeholder="Ex: com 10 itens essenciais" className="bg-background border-border/60 h-11 text-base" />
                    </Field>
                  )}
                  {sorteioTipo === "custom" && (
                    <Field label="Texto personalizado">
                      <Textarea value={sorteioCustom} onChange={(e) => setSorteioCustom(e.target.value)} placeholder="Escreva exatamente o que a IA deve falar no final…" className="bg-background border-border/60 text-sm min-h-20" />
                    </Field>
                  )}
                  {sorteioTexto && (
                    <div className="bg-primary/5 rounded-xl border border-primary/20 p-3">
                      <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1.5">Será adicionado no final</p>
                      <p className="text-xs text-foreground/85 leading-relaxed">{sorteioTexto}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="bg-card rounded-2xl border border-border/50 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Volume2 className="w-3.5 h-3.5 text-primary" />
              </span>
              <p className="text-[11px] font-bold text-foreground uppercase tracking-[0.14em]">Roteiro</p>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums font-mono">
                {textoPreview.length} car.
              </span>
            </div>
            <p className="text-[13px] text-foreground/85 leading-relaxed italic">"{textoPreview}"</p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full h-14 text-base font-bold rounded-2xl gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25"
          >
            {generating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Gerando áudio…</>
            ) : (
              <><Volume2 className="w-5 h-5" /> Gerar áudio de {kindLabel}</>
            )}
          </Button>
        </section>

        {/* ═══ LADO DIREITO — player + biblioteca ═══ */}
        <section className="space-y-3 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
          <SectionTitle icon={Play} label="Player" hint="Ouça, baixe e envie" />

          <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
            {audioUrl ? (
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
                      playing
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-105"
                        : "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-base font-bold truncate text-foreground"
                      style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                    >
                      {kindLabel} — {cidade || "cidade"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Voz Diego · prévia sem vinheta
                    </p>
                    <div className="flex gap-1.5 mt-1.5">
                      <Badge>sem vinheta</Badge>
                      {(audioBlobVinheta || lastPublicUrlVinheta) && <Badge tone="primary">com vinheta</Badge>}
                    </div>
                  </div>
                  <button
                    onClick={stopAudio}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground shrink-0"
                    title="Recomeçar"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* DOWNLOAD UNIFICADO — sempre baixa as 2 versões */}
                <Button
                  onClick={handleDownload}
                  className="w-full h-12 font-semibold rounded-xl gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Download className="w-4 h-4" />
                  Baixar áudio (com e sem vinheta)
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  {lastPublicUrl ? (
                    <AudioWhatsAppPopover
                      audioUrl={lastPublicUrl}
                      label={`${kindLabel} — ${cidade || "cidade"}`}
                      trigger={
                        <Button variant="outline" className="h-10 text-xs gap-1.5 rounded-xl w-full">
                          <Send className="w-3.5 h-3.5" /> WhatsApp (sem)
                        </Button>
                      }
                    />
                  ) : (
                    <Button variant="outline" disabled className="h-10 text-xs gap-1.5 rounded-xl">
                      <Send className="w-3.5 h-3.5" /> WhatsApp (sem)
                    </Button>
                  )}
                  {lastPublicUrlVinheta ? (
                    <AudioWhatsAppPopover
                      audioUrl={lastPublicUrlVinheta}
                      label={`${kindLabel} — ${cidade || "cidade"} (com vinheta)`}
                      trigger={
                        <Button variant="outline" className="h-10 text-xs gap-1.5 rounded-xl w-full border-primary/40 text-primary hover:bg-primary/10">
                          <Music className="w-3.5 h-3.5" /> WhatsApp (com)
                        </Button>
                      }
                    />
                  ) : (
                    <Button variant="outline" disabled className="h-10 text-xs gap-1.5 rounded-xl">
                      <Music className="w-3.5 h-3.5" /> WhatsApp (com)
                    </Button>
                  )}
                </div>

                {lastRowId && (
                  <Button
                    onClick={publishCurrent}
                    disabled={lastIsPublic}
                    variant={lastIsPublic ? "secondary" : "default"}
                    className="w-full h-10 text-xs gap-2 rounded-xl"
                  >
                    {lastIsPublic ? (
                      <><Globe2 className="w-3.5 h-3.5" /> Publicado na biblioteca</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5" /> Publicar para outros consultores</>
                    )}
                  </Button>
                )}

                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 pt-1"
                >
                  <RotateCcw className="w-3 h-3" /> Gerar novamente
                </button>
              </div>
            ) : (
              <div className="p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center mx-auto mb-3">
                  <Volume2 className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-semibold text-foreground">Nenhum áudio gerado ainda</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Preencha os dados ao lado e clique em <span className="text-primary font-medium">Gerar áudio</span>.
                </p>
              </div>
            )}
          </div>

          <SectionTitle icon={History} label="Biblioteca" hint="Áudios prontos para reaproveitar" />
          <div className="bg-card rounded-2xl border border-border/50 p-3 sm:p-4 shadow-sm space-y-3">
            <div className={`grid ${isSuperAdmin ? "grid-cols-3" : "grid-cols-2"} gap-1.5`}>
              <LibTabBtn active={libTab === "mine"} onClick={() => setLibTab("mine")} icon={History}>Meus</LibTabBtn>
              <LibTabBtn active={libTab === "public"} onClick={() => setLibTab("public")} icon={Globe2}>Pública</LibTabBtn>
              {isSuperAdmin && (
                <LibTabBtn active={libTab === "all"} onClick={() => setLibTab("all")} icon={Globe2} warning>Todos</LibTabBtn>
              )}
            </div>

            {(libTab === "public" || libTab === "all") && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Buscar por cidade…"
                  className="h-10 pl-9 text-sm bg-background border-border/60"
                />
              </div>
            )}

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1 -mr-1">
              {loadingLib && <p className="text-xs text-muted-foreground text-center py-6">Carregando…</p>}
              {!loadingLib && libTab === "mine" && myAudios.length === 0 && (
                <EmptyLib>Nenhum áudio de {kindLabel.toLowerCase()} ainda</EmptyLib>
              )}
              {!loadingLib && libTab === "public" && publicAudios.length === 0 && (
                <EmptyLib>Nenhum áudio publicado{librarySearch.trim() ? ` para "${librarySearch}"` : ""}</EmptyLib>
              )}
              {!loadingLib && libTab === "all" && allAudios.length === 0 && (
                <EmptyLib>Nenhum áudio gerado{librarySearch.trim() ? ` para "${librarySearch}"` : ""}</EmptyLib>
              )}

              {(libTab === "mine" ? myAudios : libTab === "public" ? publicAudios : allAudios).map((row) => {
                const isOpen = expandedRowId === row.id;
                const rowLabel = `${row.kind === "comercio" ? "Comércio" : "Mutirão"} — ${row.city || "cidade"}`;
                return (
                  <div
                    key={row.id}
                    className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-2 hover:border-primary/40 hover:bg-primary/[0.03] transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        onClick={() => {
                          setExpandedRowId(isOpen ? null : row.id);
                          if (!isOpen) {
                            supabase.rpc("audio_library_increment_play", { _id: row.id }).then(() => {});
                          }
                        }}
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          isOpen
                            ? "bg-primary text-primary-foreground shadow"
                            : "bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20"
                        }`}
                        title={isOpen ? "Recolher" : "Tocar"}
                      >
                        {isOpen ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate flex items-center gap-1.5">
                          {row.city || "—"}
                          {row.audio_url_vinheta && (
                            <Music className="inline w-3 h-3 text-primary shrink-0" />
                          )}
                          {row.is_public && libTab === "mine" && <Globe2 className="inline w-3 h-3 text-primary shrink-0" />}
                          {!row.is_public && libTab === "mine" && <Lock className="inline w-3 h-3 text-muted-foreground shrink-0" />}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {row.kind === "comercio" && row.place_name ? `${row.place_name} · ` : ""}
                          {row.street || "—"} · {row.time_slot}
                        </p>
                        {libTab === "public" && row.play_count > 0 && (
                          <p className="text-[10px] text-primary font-medium mt-0.5">
                            ▶ {row.play_count}× reaproveitado
                          </p>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="space-y-2 pt-1">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Sem vinheta</p>
                          <audio src={row.audio_url} controls autoPlay preload="metadata" className="w-full h-9" />
                        </div>
                        {row.audio_url_vinheta && (
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-primary mb-1">Com vinheta</p>
                            <audio src={row.audio_url_vinheta} controls preload="metadata" className="w-full h-9" />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-1.5 flex-wrap">
                      <AudioWhatsAppPopover
                        audioUrl={row.audio_url}
                        label={rowLabel}
                        trigger={
                          <button className="flex-1 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold flex items-center justify-center gap-1.5">
                            <Send className="w-3 h-3" /> WhatsApp
                          </button>
                        }
                      />
                      {row.audio_url_vinheta && (
                        <AudioWhatsAppPopover
                          audioUrl={row.audio_url_vinheta}
                          label={`${rowLabel} (com vinheta)`}
                          trigger={
                            <button className="flex-1 h-8 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-semibold flex items-center justify-center gap-1.5" title="Enviar versão com vinheta">
                              <Music className="w-3 h-3" /> Vinheta
                            </button>
                          }
                        />
                      )}
                      <button
                        onClick={() => copyRowUrl(row)}
                        className="h-8 px-2.5 rounded-lg bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] flex items-center justify-center"
                        title="Copiar link"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {libTab === "mine" && (
                        <>
                          <button
                            onClick={() => togglePublishRow(row)}
                            title={row.is_public ? "Despublicar" : "Publicar"}
                            className="h-8 px-2.5 rounded-lg bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] flex items-center justify-center"
                          >
                            {row.is_public ? <Lock className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => deleteRow(row)}
                            title="Apagar"
                            className="h-8 px-2.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive text-[11px] flex items-center justify-center"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ───────── Sub-componentes visuais locais ─────────

function SectionTitle({
  icon: Icon, label, hint,
}: { icon: typeof Volume2; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="w-1 h-5 rounded-full bg-primary" />
      <Icon className="w-3.5 h-3.5 text-primary" />
      <p
        className="text-xs font-bold uppercase tracking-[0.16em] text-foreground"
        style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
      >
        {label}
      </p>
      {hint && <span className="text-[10px] text-muted-foreground ml-1">· {hint}</span>}
    </div>
  );
}

function Field({
  icon: Icon, label, children,
}: { icon?: typeof Volume2; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em] flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ${
        on ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-all duration-300 ${
          on ? "left-[21px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Badge({
  children, tone = "muted",
}: { children: React.ReactNode; tone?: "muted" | "primary" }) {
  return (
    <span
      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
        tone === "primary"
          ? "bg-primary/15 text-primary border border-primary/25"
          : "bg-muted/50 text-muted-foreground border border-border/50"
      }`}
    >
      {children}
    </span>
  );
}

function LibTabBtn({
  active, onClick, icon: Icon, warning, children,
}: { active: boolean; onClick: () => void; icon: typeof Volume2; warning?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow shadow-primary/20"
          : warning
            ? "bg-warning/10 border border-warning/30 text-warning hover:bg-warning/15"
            : "bg-muted/30 border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30"
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

function EmptyLib({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-6">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
