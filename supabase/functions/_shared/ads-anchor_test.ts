import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isUuid,
  LEGACY_ANCHOR_CAMPAIGN_ID,
  LEGACY_MG_CONSULTANT_ID,
  LEGACY_WINNER_PHOTO_URL,
  resolveAnchorCampaignId,
  resolveWinnerPhotoUrl,
} from "./ads-anchor.ts";

const OTHER_CONSULTANT = "99999999-9999-4999-8999-999999999999";
const CONFIGURED = "abcdabcd-1234-4321-8888-abcdabcdabcd";

Deno.test("consultor configurado usa a própria âncora", () => {
  assertEquals(
    resolveAnchorCampaignId(OTHER_CONSULTANT, {
      anchor_campaign_id: CONFIGURED,
    }),
    CONFIGURED,
  );
});

Deno.test("outro consultor SEM configuração não herda a âncora do piloto", () => {
  // Herdar aqui faria o Cérebro escalar/pausar a campanha de outra pessoa.
  assertEquals(resolveAnchorCampaignId(OTHER_CONSULTANT, null), null);
  assertEquals(resolveAnchorCampaignId(OTHER_CONSULTANT, {}), null);
});

Deno.test("piloto legado continua funcionando sem configuração", () => {
  assertEquals(
    resolveAnchorCampaignId(LEGACY_MG_CONSULTANT_ID, null),
    LEGACY_ANCHOR_CAMPAIGN_ID,
  );
});

Deno.test("override do request vence, mas só se for UUID", () => {
  assertEquals(
    resolveAnchorCampaignId(LEGACY_MG_CONSULTANT_ID, null, CONFIGURED),
    CONFIGURED,
  );
  // Lixo no override não vira query: cai no fallback do piloto.
  assertEquals(
    resolveAnchorCampaignId(LEGACY_MG_CONSULTANT_ID, null, "'; drop table--"),
    LEGACY_ANCHOR_CAMPAIGN_ID,
  );
  assertEquals(resolveAnchorCampaignId(OTHER_CONSULTANT, null, 42), null);
});

Deno.test("config inválida é ignorada em favor do fallback correto", () => {
  assertEquals(
    resolveAnchorCampaignId(OTHER_CONSULTANT, {
      anchor_campaign_id: "nao-e-uuid",
    }),
    null,
  );
});

Deno.test("criativo: só HTTPS configurado; piloto tem fallback", () => {
  assertEquals(
    resolveWinnerPhotoUrl(OTHER_CONSULTANT, {
      winner_photo_url: "https://cdn.test/a.png",
    }),
    "https://cdn.test/a.png",
  );
  // HTTP simples e URL inválida não viram criativo.
  assertEquals(
    resolveWinnerPhotoUrl(OTHER_CONSULTANT, {
      winner_photo_url: "http://cdn.test/a.png",
    }),
    null,
  );
  assertEquals(
    resolveWinnerPhotoUrl(OTHER_CONSULTANT, { winner_photo_url: "xxx" }),
    null,
  );
  assertEquals(resolveWinnerPhotoUrl(OTHER_CONSULTANT, null), null);
  assertEquals(
    resolveWinnerPhotoUrl(LEGACY_MG_CONSULTANT_ID, null),
    LEGACY_WINNER_PHOTO_URL,
  );
});

Deno.test("isUuid aceita só UUID de verdade", () => {
  assertEquals(isUuid(LEGACY_ANCHOR_CAMPAIGN_ID), true);
  assertFalse(isUuid("a0189d12"));
  assertFalse(isUuid(""));
  assertFalse(isUuid(null));
});
