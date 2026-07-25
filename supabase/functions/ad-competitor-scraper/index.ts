// Coleta anúncios reais ATIVOS dos concorrentes via Meta Ad Library Graph API
// (/ads_archive). Para cada anúncio: baixa o ad_snapshot_url, extrai a primeira
// imagem (og:image) ou thumbnail de vídeo, persiste no MinIO e grava em
// ad_competitor_creatives. Idempotente por ad_archive_id (oficial da Meta).
import {
  adminClient,
  authConsultant,
  FB_GRAPH,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { uploadToMinioPath } from "../_shared/minio-upload.ts";
import { geminiGenerate } from "../_shared/gemini.ts";

const COMPETITORS = [
  "iGreen Energy",
  "Solfácil",
  "Lemon Energia",
  "Órigo Energia",
  "Setta Energia",
  "Bright Energia",
  "Genyx Energia",
  "Reverde Energia",
  "Alexandria Energia",
  "Matrix Energia",
];

interface ArchiveAd {
  id: string;
  page_name?: string;
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
}

async function searchAds(
  token: string,
  advertiser: string,
): Promise<ArchiveAd[]> {
  const params = new URLSearchParams({
    search_terms: advertiser,
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(["BR"]),
    ad_active_status: "ACTIVE",
    fields:
      "id,page_name,ad_snapshot_url,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_creative_link_descriptions,ad_delivery_start_time,ad_delivery_stop_time",
    limit: "10",
    access_token: token,
  });
  try {
    const res = await fbFetch(`/ads_archive?${params.toString()}`);
    return Array.isArray(res?.data) ? res.data as ArchiveAd[] : [];
  } catch (e) {
    console.warn(
      `[scraper] /ads_archive falhou para ${advertiser}:`,
      (e as Error).message,
    );
    return [];
  }
}

// Extrai primeira imagem útil do snapshot HTML público da Biblioteca de Anúncios.
function extractImageFromSnapshot(
  html: string,
): { image?: string; video?: string } {
  const out: { image?: string; video?: string } = {};
  const og = html.match(
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
  );
  if (og?.[1]) out.image = og[1].replace(/&amp;/g, "&");
  const ogv = html.match(
    /<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i,
  );
  if (ogv?.[1]) out.video = ogv[1].replace(/&amp;/g, "&");
  if (!out.image) {
    const m = html.match(/"image_url":"([^"]+)"/);
    if (m?.[1]) out.image = m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }
  if (!out.video) {
    const m = html.match(/"video_(?:hd|sd)_url":"([^"]+)"/);
    if (m?.[1]) out.video = m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }
  return out;
}

async function uploadImage(
  srcUrl: string,
  archiveId: string,
  advertiser: string,
): Promise<string | null> {
  try {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "image/jpeg";
    const ext = ct.includes("png")
      ? "png"
      : ct.includes("webp")
      ? "webp"
      : "jpg";
    const bytes = new Uint8Array(await r.arrayBuffer());
    const slug = advertiser.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const key = `competitors/${slug}/${archiveId}.${ext}`;
    const up = await uploadToMinioPath(bytes, ct, key);
    return up.url;
  } catch (e) {
    console.warn(
      `[scraper] upload imagem falhou ${archiveId}:`,
      (e as Error).message,
    );
    return null;
  }
}

async function classifyAngle(
  headline: string,
  body: string,
): Promise<string | null> {
  if (!headline && !body) return null;
  try {
    const r = await geminiGenerate({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Classifique este anúncio em UM angle:
economia_concreta | quebra_objecao | prova_social | curiosidade | dor_pas | urgencia_local

Headline: ${headline || "(vazio)"}
Texto: ${body || "(vazio)"}

Responda APENAS com a palavra do angle, sem nada mais.`,
        }],
      }],
      temperature: 0,
      functionName: "ad-competitor-scraper-classify",
    });
    const t = (r.text || "").trim().toLowerCase();
    const valid = [
      "economia_concreta",
      "quebra_objecao",
      "prova_social",
      "curiosidade",
      "dor_pas",
      "urgencia_local",
    ];
    return valid.find((v) => t.includes(v)) || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const admin = adminClient();
    // Cron semanal usa credencial de serviço; o botão do consultor na UI
    // (CompetitorsPanel) chega com JWT. Anônimo continua bloqueado.
    const cronAuth = await assertCronAuthStrict(req, admin);
    if (!cronAuth.ok && !(await authConsultant(req))) {
      return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
    }

    const platform = await loadPlatformAccount();
    if (!platform?.token) {
      return new Response(
        JSON.stringify({ error: "platform_facebook_account não configurado" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const stats = {
      advertisers: COMPETITORS.length,
      found: 0,
      with_image: 0,
      upserted: 0,
      errors: [] as string[],
    };

    const url = new URL(req.url);
    const backfill = url.searchParams.get("backfill") === "1";

    if (backfill) {
      // Re-popula imagens dos registros existentes que estão sem image_url
      const { data: pending } = await admin
        .from("ad_competitor_creatives")
        .select("id, ad_archive_id, advertiser")
        .is("image_url", null)
        .limit(50);
      for (const row of pending || []) {
        const ads = await searchAds(platform.token, row.advertiser);
        for (const ad of ads.slice(0, 3)) {
          if (!ad.ad_snapshot_url) continue;
          try {
            const html = await (await fetch(ad.ad_snapshot_url)).text();
            const media = extractImageFromSnapshot(html);
            if (media.image) {
              const stored = await uploadImage(
                media.image,
                ad.id,
                row.advertiser,
              );
              if (stored) {
                await admin.from("ad_competitor_creatives").update({
                  image_url: stored,
                  thumbnail_url: stored,
                }).eq("id", row.id);
                stats.with_image++;
                break;
              }
            }
          } catch (e) {
            stats.errors.push(
              `backfill ${row.advertiser}: ${(e as Error).message}`,
            );
          }
        }
      }
      return new Response(
        JSON.stringify({ ok: true, mode: "backfill", ...stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    for (const advertiser of COMPETITORS) {
      const ads = await searchAds(platform.token, advertiser);
      stats.found += ads.length;
      for (const ad of ads) {
        try {
          let imageUrl: string | null = null;
          let videoUrl: string | null = null;
          if (ad.ad_snapshot_url) {
            try {
              const html = await (await fetch(ad.ad_snapshot_url)).text();
              const media = extractImageFromSnapshot(html);
              if (media.image) {
                imageUrl = await uploadImage(media.image, ad.id, advertiser);
                if (imageUrl) stats.with_image++;
              }
              if (media.video) videoUrl = media.video;
            } catch (e) {
              console.warn(
                `[scraper] snapshot falhou ${ad.id}:`,
                (e as Error).message,
              );
            }
          }
          const headline = ad.ad_creative_link_titles?.[0]?.slice(0, 200);
          const body = ad.ad_creative_bodies?.[0]?.slice(0, 600);
          const angle = await classifyAngle(headline || "", body || "");
          const start = ad.ad_delivery_start_time
            ? new Date(ad.ad_delivery_start_time)
            : null;
          const activeDays = start
            ? Math.max(
              1,
              Math.floor((Date.now() - start.getTime()) / 86400_000),
            )
            : 0;
          const { error } = await admin.from("ad_competitor_creatives").upsert({
            advertiser,
            ad_archive_id: ad.id,
            page_id: null,
            headline,
            primary_text: body,
            cta: undefined,
            creative_format: videoUrl ? "video" : "estatico",
            angle,
            active_days: activeDays,
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            video_url: videoUrl,
            first_seen_at: start?.toISOString() || new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            ingested_at: new Date().toISOString(),
            raw: ad as any,
          }, { onConflict: "ad_archive_id" });
          if (!error) stats.upserted++;
          else stats.errors.push(`${advertiser}/${ad.id}: ${error.message}`);
        } catch (e) {
          stats.errors.push(`${advertiser}/${ad.id}: ${(e as Error).message}`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
