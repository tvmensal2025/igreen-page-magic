import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { buildConsultantSlug, sanitizeJid, normalizeName } from "../_shared/minio-upload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

const ALLOWED_TYPES: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"],
  // WhatsApp/Whapi rejeita .webm em mensagens de voz; grave/envie OGG/Opus, MP3, M4A ou WAV.
  audio: ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav", "audio/aac", "audio/x-m4a"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/3gpp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

function getAllowedTypes(): string[] {
  return Object.values(ALLOWED_TYPES).flat();
}

function getExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  return map[mime] || "bin";
}

// ── AWS Signature V4 for MinIO ──────────────────────────────────────────
async function hmacSHA256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string) {
  let kDate = await hmacSHA256(new TextEncoder().encode("AWS4" + key), dateStamp);
  let kRegion = await hmacSHA256(kDate, region);
  let kService = await hmacSHA256(kRegion, service);
  let kSigning = await hmacSHA256(kService, "aws4_request");
  return kSigning;
}

interface MinIOUploadParams {
  serverUrl: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  objectKey: string;
  fileBytes: Uint8Array;
  contentType: string;
}

async function uploadToMinIO(params: MinIOUploadParams): Promise<void> {
  const { serverUrl, accessKey, secretKey, bucket, objectKey, fileBytes, contentType } = params;

  const url = new URL(`/${bucket}/${objectKey}`, serverUrl);
  const host = url.host;
  const region = "us-east-1";
  const service = "s3";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.substring(0, 8);

  const payloadHash = await sha256Hex(fileBytes);

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${objectKey}`,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSignatureKey(secretKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Host": host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Authorization": authHeader,
    },
    body: fileBytes,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`MinIO upload failed (${res.status}): ${errBody}`);
  }
}

// ── Check if user is admin ──────────────────────────────────────────────
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const minioUrl = Deno.env.get("MINIO_SERVER_URL") ?? "";
    const minioUser = Deno.env.get("MINIO_ROOT_USER") ?? "";
    const minioPass = Deno.env.get("MINIO_ROOT_PASSWORD") ?? "";
    const minioBucket = Deno.env.get("MINIO_BUCKET") ?? "igreen";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Supabase credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!minioUrl || !minioUser || !minioPass) {
      return new Response(
        JSON.stringify({ error: "MinIO credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Authenticate the caller ─────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    
    let userId: string | null = null;
    let userIsAdmin = false;

    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
        userIsAdmin = await isAdmin(supabase, userId);
      }
    }

    // ── Parse form data ─────────────────────────────────────────────────
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size > MAX_SIZE) {
      return new Response(
        JSON.stringify({ error: "File too large (max 100MB)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allowed = getAllowedTypes();
    // Normaliza MIME: navegadores enviam "audio/ogg; codecs=opus", "audio/webm;codecs=opus" etc.
    const rawType = String(file.type || "").toLowerCase();
    let normalizedType = rawType.split(";")[0].trim();
    // Aliases comuns: webm/opus do MediaRecorder vira ogg para o WhatsApp.
    if (normalizedType === "audio/webm" || normalizedType === "audio/x-opus+ogg") {
      normalizedType = "audio/ogg";
    }
    // Aliases de imagem: alguns navegadores/celulares mandam variações.
    if (normalizedType === "image/jpg" || normalizedType === "image/pjpeg") {
      normalizedType = "image/jpeg";
    }
    // Fallback: se o MIME veio vazio, infere pela extensão do nome do arquivo.
    if (!normalizedType) {
      const extLower = (file.name.split(".").pop() || "").toLowerCase();
      const extToMime: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
        heic: "image/heic", heif: "image/heif",
        mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
        mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", "3gp": "video/3gpp",
        pdf: "application/pdf",
      };
      normalizedType = extToMime[extLower] || "";
    }
    if (!allowed.includes(normalizedType)) {
      return new Response(
        JSON.stringify({ error: `File type not allowed: ${file.type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ext = getExtension(normalizedType);
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // ── Determine media kind from MIME ────────────────────────────────
    const inferKind = (mime: string): "image" | "audio" | "video" | "document" => {
      if (mime.startsWith("image/")) return "image";
      if (mime.startsWith("audio/")) return "audio";
      if (mime.startsWith("video/")) return "video";
      return "document";
    };

    // ── Optional context fields ───────────────────────────────────────
    // scope: "chat" | "template" | "avatar" | "doc" | "generic"
    const scope = String(formData.get("scope") || "").trim() || (userIsAdmin ? "admin" : "generic");
    let consultantIdField = String(formData.get("consultant_id") || userId || "").trim();
    const customerJid = String(formData.get("customer_jid") || "").trim();
    let customerNameField = String(formData.get("customer_name") || "").trim();
    const customerIdField = String(formData.get("customer_id") || "").trim();
    const slugHint = String(formData.get("slug") || "").trim();
    const kindField = String(formData.get("kind") || inferKind(normalizedType)).trim();

    // ── scope=doc: resolve consultor/cliente a partir do customer_id ──
    // Mantém a MESMA pasta usada pelo bot (_shared/media-storage.ts):
    // documentos/{consultor}/{cliente}/  — documento do cliente fica junto.
    let customerBirth: string | null = null;
    if (scope === "doc" && customerIdField) {
      const { data: cust } = await supabase
        .from("customers")
        .select("name, consultant_id, data_nascimento_iso, data_nascimento")
        .eq("id", customerIdField)
        .maybeSingle();
      if (cust) {
        if (!customerNameField) customerNameField = String((cust as any).name || "");
        if ((cust as any).consultant_id) consultantIdField = String((cust as any).consultant_id);
        customerBirth = (cust as any).data_nascimento_iso || (cust as any).data_nascimento || null;
      }
    }

    // ── Resolve consultor slug ────────────────────────────────────────
    let consultantSlug = "sem_consultor";
    if (consultantIdField) {
      const { data: c } = await supabase
        .from("consultants")
        .select("igreen_id, name")
        .eq("id", consultantIdField)
        .maybeSingle();
      consultantSlug = buildConsultantSlug(c?.igreen_id || consultantIdField, c?.name || null);
    }

    const ts = Date.now();
    const safeFileBase = slugHint
      ? `${normalizeName(slugHint)}_${ts}`
      : `${ts}_${crypto.randomUUID().slice(0, 8)}`;

    // ── Build object key based on scope ───────────────────────────────
    let objectKey: string;
    switch (scope) {
      case "chat": {
        const jid = sanitizeJid(customerJid);
        objectKey = `whatsapp/${consultantSlug}/${jid}/${kindField}/${safeFileBase}.${ext}`;
        break;
      }
      case "doc": {
        const parts = (customerNameField || "cliente").trim().split(/\s+/);
        const first = normalizeName(parts[0] || "cliente");
        const last = normalizeName(parts[parts.length - 1] || "x");
        let dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const mBr = customerBirth?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const mIso = customerBirth?.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (mBr) dateStr = `${mBr[3]}${mBr[2]}${mBr[1]}`;
        else if (mIso) dateStr = `${mIso[1]}${mIso[2]}${mIso[3]}`;
        const customerSlug = `${first}_${last}_${dateStr}`;
        objectKey = `documentos/${consultantSlug}/${customerSlug}/${normalizeName(kindField)}_${ts}.${ext}`;
        break;
      }
      case "template": {
        objectKey = `templates/${consultantSlug}/${kindField}/${safeFileBase}.${ext}`;
        break;
      }
      case "avatar": {
        objectKey = `consultores/${consultantSlug}/avatar_${ts}.${ext}`;
        break;
      }
      case "admin":
        objectKey = `public/media/${safeFileBase}.${ext}`;
        break;
      default:
        objectKey = userId
          ? `private/${userId}/${safeFileBase}.${ext}`
          : `public/uploads/${safeFileBase}.${ext}`;
    }


    console.log(`📦 [upload-media] scope=${scope} key=${objectKey} (${file.type}, ${file.size}B)`);

    let storageBackend: "minio" | "supabase" = "minio";
    let publicUrl: string;
    try {
      await uploadToMinIO({
        serverUrl: minioUrl,
        accessKey: minioUser,
        secretKey: minioPass,
        bucket: minioBucket,
        objectKey,
        fileBytes,
        contentType: normalizedType,
      });
      publicUrl = `${minioUrl}/${minioBucket}/${objectKey}`;
    } catch (minioErr: any) {
      console.warn(`📦⚠️ MinIO falhou, fallback Supabase: ${minioErr?.message}`);
      storageBackend = "supabase";
      const fallbackKey = userId
        ? `private/${userId}/${safeFileBase}.${ext}`
        : `public/${safeFileBase}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(fallbackKey, fileBytes, {
          contentType: normalizedType,
          upsert: false,
          cacheControl: "31536000",
        });
      if (upErr) throw new Error(`Both MinIO and Supabase failed: ${upErr.message}`);
      // Bucket privado: URL pública responderia 400 para quem for baixar a mídia.
      const { data: signed, error: signErr } = await supabase.storage
        .from("whatsapp-media")
        .createSignedUrl(fallbackKey, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) {
        throw new Error(`Supabase signed URL failed: ${signErr?.message || "sem URL"}`);
      }
      publicUrl = signed.signedUrl;

      objectKey = fallbackKey;
    }

    return new Response(
      JSON.stringify({
        url: publicUrl,
        key: objectKey,
        type: normalizedType,
        size: file.size,
        storage: storageBackend,
        visibility: userIsAdmin ? "public" : "private",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("upload-media error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
