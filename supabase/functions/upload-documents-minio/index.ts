import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";
import { parseSupabaseStorageUrl } from "../_shared/storage-download.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── AWS Signature V4 for MinIO ──────────────────────────────────────────
async function hmacSHA256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<Uint8Array> {
  const kDate = await hmacSHA256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSHA256(kDate, regionName);
  const kService = await hmacSHA256(kRegion, serviceName);
  const kSigning = await hmacSHA256(kService, "aws4_request");
  return kSigning;
}

function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

  const url = new URL(serverUrl);
  const host = url.host;
  const region = "us-east-1";
  const service = "s3";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.buffer as ArrayBuffer)));

  const canonicalUri = `/${bucket}/${objectKey}`;
  const canonicalQuerystring = "";
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = `PUT\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRequest)))
  )}`;

  const signingKey = await getSignatureKey(secretKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const uploadUrl = `${serverUrl}${canonicalUri}`;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorizationHeader,
    },
    body: fileBytes,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`MinIO upload failed (${res.status}): ${errBody}`);
  }
}

// ── Função para normalizar nome (remover acentos e caracteres especiais) ──
function normalizeFileName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-zA-Z0-9_-]/g, "_") // Substitui caracteres especiais por _
    .replace(/_+/g, "_") // Remove underscores duplicados
    .toLowerCase();
}

// ── Função para extrair primeiro nome e sobrenome ──
function extractFirstLastName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "cliente";
  const lastName = parts[parts.length - 1] || "desconhecido";
  return { firstName, lastName };
}

// ── Função para formatar data (YYYYMMDD) ──
function formatDate(dateString: string | null): string {
  if (!dateString) {
    return new Date().toISOString().split("T")[0].replace(/-/g, "");
  }

  // Tentar parsear DD/MM/AAAA
  const match = dateString.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}${month}${day}`;
  }

  // Fallback: data atual
  return new Date().toISOString().split("T")[0].replace(/-/g, "");
}

// ── Baixar arquivo de URL ──
async function downloadFile(
  url: string,
  supabase?: any,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // Se for data URL
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const contentType = match[1];
      const base64 = match[2];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return { bytes, contentType };
    }
  }

  // Supabase Storage: `whatsapp-media` é bucket PRIVADO — a URL /object/public/
  // gravada em customers responde HTTP 400 no fetch cru. Baixa via service role.
  const parsed = supabase ? parseSupabaseStorageUrl(url) : null;
  if (parsed && supabase) {
    const { data, error } = await supabase.storage.from(parsed.bucket).download(parsed.path);
    if (error || !data) {
      throw new Error(`Failed to download file (storage): ${error?.message || "sem dados"}`);
    }
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  }

  // Baixar de URL
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { bytes, contentType };
}

// ── Detectar extensão do arquivo ──
function getFileExtension(contentType: string, url: string): string {
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "image/heic": "heic",
    "image/heif": "heif",
  };

  // Tentar pelo content-type
  if (mimeToExt[contentType]) {
    return mimeToExt[contentType];
  }

  // Tentar pela URL
  const urlMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

  // Fallback
  return "jpg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Guarda IDOR (REQ 5): parse do corpo uma vez + auth/posse ANTES de qualquer efeito colateral ──
    const { customer_id } = await req.json();

    const caller = await resolveCaller(req, supabase as any);
    if (caller instanceof Response) return caller;
    const deny = await assertOwnership(caller, { customerId: customer_id }, supabase as any);
    if (deny) return deny;

    const minioUrl = Deno.env.get("MINIO_SERVER_URL") || "";
    const minioUser = Deno.env.get("MINIO_ROOT_USER") || "";
    const minioPass = Deno.env.get("MINIO_ROOT_PASSWORD") || "";
    const minioBucket = Deno.env.get("MINIO_BUCKET") || "igreen";

    if (!minioUrl || !minioUser || !minioPass) {
      console.error("❌ MinIO credentials not configured");
      return new Response(
        JSON.stringify({ error: "MinIO credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: "customer_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Iniciando upload MinIO para customer: ${customer_id}`);

    // Buscar dados do cliente
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customer_id)
      .single();

    if (customerError || !customer) {
      console.error("❌ Cliente não encontrado:", customerError);
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar consultor separadamente
    let consultant: any = null;
    if (customer.consultant_id) {
      const { data: c } = await supabase
        .from("consultants")
        .select("id, name, igreen_id")
        .eq("id", customer.consultant_id)
        .single();
      consultant = c;
    }

    const consultantId = consultant?.igreen_id || consultant?.id || "sem_consultor";
    const consultantName = consultant?.name || "Consultor";

    console.log(`👤 Consultor: ${consultantName} (ID: ${consultantId})`);

    // Extrair nome e data do cliente
    const fullName = customer.name || "Cliente Desconhecido";
    const { firstName, lastName } = extractFirstLastName(fullName);
    const dateFormatted = formatDate(customer.data_nascimento);

    // Normalizar nome para usar no arquivo
    const firstNameNorm = normalizeFileName(firstName);
    const lastNameNorm = normalizeFileName(lastName);
    const consultantNameNorm = normalizeFileName(consultantName);

    // NOVO FORMATO HIERÁRQUICO:
    //   documentos/{consultantId}_{consultantName}/{firstName}_{lastName}_{YYYYMMDD}/{kind}.{ext}
    // Ex: documentos/124661_joao_silva/maria_santos_19850315/conta.pdf
    const consultantSlug = consultantNameNorm
      ? `${consultantId}_${consultantNameNorm}`
      : `${consultantId}`;
    const customerSlug = `${firstNameNorm}_${lastNameNorm}_${dateFormatted}`;
    const folderPath = `documentos/${consultantSlug}/${customerSlug}`;
    // baseFileName mantido apenas para resposta/log (não compõe mais o nome do arquivo)
    const baseFileName = customerSlug;

    console.log(`📝 Pasta consultor: ${consultantSlug}`);
    console.log(`📝 Pasta cliente: ${customerSlug}`);
    console.log(`📝 Folder path: ${folderPath}`);

    const uploads: Array<{ type: string; url: string; success: boolean; error?: string }> = [];

    // ── Upload Conta de Energia ──
    if (customer.electricity_bill_photo_url && customer.electricity_bill_photo_url !== "evolution-media:pending") {
      try {
        console.log("📄 Baixando conta de energia...");
        const { bytes, contentType } = await downloadFile(customer.electricity_bill_photo_url, supabase);
        const ext = getFileExtension(contentType, customer.electricity_bill_photo_url);
        const objectKey = `${folderPath}/conta.${ext}`;

        console.log(`📤 Uploading conta: ${objectKey}`);
        await uploadToMinIO({
          serverUrl: minioUrl,
          accessKey: minioUser,
          secretKey: minioPass,
          bucket: minioBucket,
          objectKey,
          fileBytes: bytes,
          contentType,
        });

        const publicUrl = `${minioUrl}/${minioBucket}/${objectKey}`;
        uploads.push({ type: "conta", url: publicUrl, success: true });
        console.log(`✅ Conta uploaded: ${publicUrl}`);
      } catch (e: any) {
        console.error("❌ Erro upload conta:", e.message);
        uploads.push({ type: "conta", url: "", success: false, error: e.message });
      }
    }

    // ── Upload Documento Frente ──
    if (customer.document_front_url && customer.document_front_url !== "evolution-media:pending" && customer.document_front_url !== "collected") {
      try {
        console.log("📄 Baixando documento frente...");
        const { bytes, contentType } = await downloadFile(customer.document_front_url, supabase);
        const ext = getFileExtension(contentType, customer.document_front_url);
        const objectKey = `${folderPath}/doc_frente.${ext}`;

        console.log(`📤 Uploading doc frente: ${objectKey}`);
        await uploadToMinIO({
          serverUrl: minioUrl,
          accessKey: minioUser,
          secretKey: minioPass,
          bucket: minioBucket,
          objectKey,
          fileBytes: bytes,
          contentType,
        });

        const publicUrl = `${minioUrl}/${minioBucket}/${objectKey}`;
        uploads.push({ type: "doc_frente", url: publicUrl, success: true });
        console.log(`✅ Doc frente uploaded: ${publicUrl}`);
      } catch (e: any) {
        console.error("❌ Erro upload doc frente:", e.message);
        uploads.push({ type: "doc_frente", url: "", success: false, error: e.message });
      }
    }

    // ── Upload Documento Verso ──
    if (customer.document_back_url && customer.document_back_url !== "evolution-media:pending" && customer.document_back_url !== "collected" && customer.document_back_url !== "nao_aplicavel") {
      try {
        console.log("📄 Baixando documento verso...");
        const { bytes, contentType } = await downloadFile(customer.document_back_url, supabase);
        const ext = getFileExtension(contentType, customer.document_back_url);
        const objectKey = `${folderPath}/doc_verso.${ext}`;

        console.log(`📤 Uploading doc verso: ${objectKey}`);
        await uploadToMinIO({
          serverUrl: minioUrl,
          accessKey: minioUser,
          secretKey: minioPass,
          bucket: minioBucket,
          objectKey,
          fileBytes: bytes,
          contentType,
        });

        const publicUrl = `${minioUrl}/${minioBucket}/${objectKey}`;
        uploads.push({ type: "doc_verso", url: publicUrl, success: true });
        console.log(`✅ Doc verso uploaded: ${publicUrl}`);
      } catch (e: any) {
        console.error("❌ Erro upload doc verso:", e.message);
        uploads.push({ type: "doc_verso", url: "", success: false, error: e.message });
      }
    }

    const successCount = uploads.filter((u) => u.success).length;
    const totalCount = uploads.length;

    console.log(`📦 Upload MinIO concluído: ${successCount}/${totalCount} arquivos`);

    return new Response(
      JSON.stringify({
        success: true,
        customer_id,
        consultant_id: consultantId,
        consultant_name: consultantName,
        base_file_name: baseFileName,
        folder_path: folderPath,
        uploads,
        summary: {
          total: totalCount,
          success: successCount,
          failed: totalCount - successCount,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ Erro geral upload MinIO:", err);
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
