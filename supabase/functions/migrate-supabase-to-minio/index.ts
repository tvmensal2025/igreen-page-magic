// Migra mídias do Supabase Storage (whatsapp-media, consultant-photos) para o MinIO
// Idempotente, processa em lotes. Pode ser chamado repetidamente até concluir.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { uploadToMinioPath, normalizeName, buildConsultantSlug, sanitizeJid, extFromMime } from "../_shared/minio-upload.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface RunOpts { bucket: string; batchSize: number; prefix?: string; }

function guessKindFromMime(mime: string): string {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function extFromPath(path: string, mime: string): string {
  const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (m) return m[1].toLowerCase();
  return extFromMime(mime || "");
}

async function listAll(bucket: string, prefix = "", limit = 1000): Promise<any[]> {
  const all: any[] = [];
  // Recursively list folders (Supabase storage list is non-recursive)
  // Prefixo precisa vir sem "/" nas pontas, senão o fullPath sai com "//".
  const stack: string[] = [prefix.replace(/^\/+|\/+$/g, "")];

  while (stack.length) {
    const cur = stack.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(cur, { limit, offset });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const it of data) {
        const fullPath = cur ? `${cur}/${it.name}` : it.name;
        if (!it.id && !it.metadata) {
          // folder
          stack.push(fullPath);
        } else {
          all.push({ ...it, fullPath });
        }
      }
      if (data.length < limit) break;
      offset += data.length;
    }
  }
  return all;
}

/** Slot da ficha → nome de arquivo no MinIO (mesmo padrão do upload-media). */
const KIND_BY_SLOT: Record<string, string> = {
  document_front_url: "doc_frente",
  document_back_url: "doc_verso",
  electricity_bill_photo_url: "conta",
  electricity_boleto_photo_url: "boleto",
};

async function findOwnerForWhatsappPath(path: string): Promise<{
  consultant_id?: string;
  consultant_slug?: string;
  jid?: string;
  kind?: string;
  customer_slug?: string;
}> {
  // A tabela de chat é `conversations` (não existe `messages`). Ela não guarda
  // media_url, então o dono só é resolvido quando o path já é `documentos/...`
  // ou `captacao/{customer_id}/...` — o resto vira legado sem dono.
  const m = path.match(/^captacao\/([0-9a-f-]{36})\//i);
  if (!m) return {};
  const { data } = await admin
    .from("customers")
    .select("id,name,consultant_id,phone_whatsapp,data_nascimento_iso,data_nascimento,consultants:consultant_id(igreen_id,name)")
    .eq("id", m[1])
    .maybeSingle();
  if (!data) return {};
  const c = (data as any).consultants;
  const slotMatch = path.split("/").pop()?.match(/^([a-z_]+)-\d+/i);
  const birth: string | null =
    (data as any).data_nascimento_iso || (data as any).data_nascimento || null;
  const mBr = birth?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const mIso = birth?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dateStr = mBr
    ? `${mBr[3]}${mBr[2]}${mBr[1]}`
    : mIso
      ? `${mIso[1]}${mIso[2]}${mIso[3]}`
      : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const parts = String((data as any).name || "cliente").trim().split(/\s+/);
  return {
    consultant_id: (data as any).consultant_id || undefined,
    consultant_slug: c ? buildConsultantSlug(c.igreen_id || (data as any).consultant_id, c.name) : undefined,
    jid: (data as any).phone_whatsapp || undefined,
    kind: slotMatch ? KIND_BY_SLOT[slotMatch[1]] : undefined,
    customer_slug: `${normalizeName(parts[0] || "cliente")}_${normalizeName(parts[parts.length - 1] || "x")}_${dateStr}`,
  };
}


/** Colunas de documento do cliente que podem apontar para o Storage antigo. */
const CUSTOMER_DOC_COLUMNS = [
  "document_front_url",
  "document_back_url",
  "electricity_bill_photo_url",
  "electricity_boleto_photo_url",
] as const;

async function rewriteCustomerDocRefs(oldUrl: string, path: string, newUrl: string): Promise<number> {
  let changed = 0;
  for (const col of CUSTOMER_DOC_COLUMNS) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .ilike(col, `%${path}%`)
      .limit(500);
    for (const row of (data || []) as any[]) {
      const { error } = await admin.from("customers").update({ [col]: newUrl }).eq("id", row.id);
      if (!error) changed++;
    }
  }
  if (!changed && oldUrl) {
    for (const col of CUSTOMER_DOC_COLUMNS) {
      const { data } = await admin.from("customers").update({ [col]: newUrl }).eq(col, oldUrl).select("id");
      changed += (data || []).length;
    }
  }
  return changed;
}

async function migrateOne(bucket: string, path: string): Promise<{ ok: boolean; error?: string; target?: string }> {
  // already migrated?
  const { data: existing } = await admin
    .from("storage_migration_log")
    .select("id,status,target_url")
    .eq("source_bucket", bucket).eq("source_path", path).maybeSingle();
  if (existing && existing.status === "done") return { ok: true, target: existing.target_url };

  // Mark started
  const logRow = {
    source_bucket: bucket,
    source_path: path,
    status: "in_progress",
    started_at: new Date().toISOString(),
    attempts: ((existing as any)?.attempts || 0) + 1,
  };
  await admin.from("storage_migration_log").upsert(logRow, { onConflict: "source_bucket,source_path" });

  try {
    const dl = await admin.storage.from(bucket).download(path);
    if (dl.error) throw dl.error;
    const blob = dl.data!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentType = blob.type || "application/octet-stream";
    const ext = extFromPath(path, contentType);

    let objectKey: string;
    let consultantId: string | undefined;
    let jid: string | undefined;
    let kind: string | undefined;

    if (bucket === "consultant-photos") {
      // path tipicamente: {consultant_id}/avatar.ext  ou  {consultant_id}/...
      const segs = path.split("/");
      const cid = segs[0] || "sem_consultor";
      consultantId = cid;
      const { data: cons } = await admin.from("consultants").select("igreen_id,name").eq("id", cid).maybeSingle();
      const slug = cons ? buildConsultantSlug((cons as any).igreen_id || cid, (cons as any).name) : normalizeName(cid);
      objectKey = `consultores/${slug}/avatar_legacy_${Date.now()}.${ext}`;
    } else if (bucket === "whatsapp-media" && path.startsWith("documentos/")) {
      // Já está no layout canônico do MinIO — copia com a mesma pasta.
      objectKey = path;
    } else if (bucket === "whatsapp-media") {
      const owner = await findOwnerForWhatsappPath(path);
      consultantId = owner.consultant_id;
      jid = owner.jid;
      kind = owner.kind || guessKindFromMime(contentType);
      const slug = owner.consultant_slug || normalizeName(owner.consultant_id || "sem_consultor");
      const jidFolder = sanitizeJid(jid || "sem_cliente");
      const ts = Date.now();
      objectKey = `whatsapp/${slug}/${jidFolder}/${kind}/legacy_${ts}.${ext}`;
    } else {
      throw new Error(`Bucket não suportado: ${bucket}`);
    }

    const up = await uploadToMinioPath(bytes, contentType, objectKey);

    // Update references in DB
    const { data: pubData } = admin.storage.from(bucket).getPublicUrl(path);
    const oldUrl = pubData.publicUrl;

    if (bucket === "whatsapp-media") {
      await rewriteCustomerDocRefs(oldUrl, path, up.url);
      await admin.from("message_templates").update({ media_url: up.url }).eq("media_url", oldUrl);
      await admin.from("message_templates").update({ image_url: up.url }).eq("image_url", oldUrl);
    } else if (bucket === "consultant-photos") {
      await admin.from("consultants").update({ photo_url: up.url }).eq("photo_url", oldUrl);
      if (consultantId) await admin.from("consultants").update({ photo_url: up.url }).eq("id", consultantId).is("photo_url", null);
    }

    await admin.from("storage_migration_log").update({
      status: "done",
      target_url: up.url,
      target_object_key: up.objectKey,
      consultant_id: consultantId,
      customer_jid: jid,
      media_kind: kind,
      size_bytes: bytes.byteLength,
      source_url: oldUrl,
      completed_at: new Date().toISOString(),
    }).eq("source_bucket", bucket).eq("source_path", path);

    return { ok: true, target: up.url };
  } catch (err) {
    const msg = String((err as any)?.message || err).slice(0, 500);
    await admin.from("storage_migration_log").update({
      status: "failed",
      error: msg,
    }).eq("source_bucket", bucket).eq("source_path", path);
    return { ok: false, error: msg };
  }
}

async function runForBucket(opts: RunOpts) {
  const { bucket, batchSize, prefix } = opts;
  const items = await listAll(bucket, prefix || "");
  // Filter out already-done
  const { data: done } = await admin
    .from("storage_migration_log")
    .select("source_path")
    .eq("source_bucket", bucket)
    .eq("status", "done");
  const doneSet = new Set((done || []).map((d: any) => d.source_path));
  const pending = items.filter((it: any) => !doneSet.has(it.fullPath));
  const batch = pending.slice(0, batchSize);

  let ok = 0, fail = 0;
  const errors: string[] = [];
  for (const it of batch) {
    const r = await migrateOne(bucket, it.fullPath);
    if (r.ok) ok++; else { fail++; if (errors.length < 10) errors.push(`${it.fullPath}: ${r.error}`); }
  }
  return { bucket, total: items.length, pending: pending.length, processed: batch.length, ok, fail, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // AUTH: migração em massa só por service-role ou admin logado.
    if (!isServiceRoleAuth(req)) {
      const caller = await resolveCaller(req, admin as any);
      if (caller instanceof Response) return caller;
      if (caller.mode === "jwt" && !caller.isAdmin) {
        return new Response(JSON.stringify({ success: false, error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const buckets: string[] = body.buckets || ["whatsapp-media", "consultant-photos"];
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 25, 1), 200);
    const prefix: string | undefined = body.prefix ? String(body.prefix) : undefined;
    const results = [] as any[];
    for (const b of buckets) {
      results.push(await runForBucket({ bucket: b, batchSize, prefix }));
    }

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
