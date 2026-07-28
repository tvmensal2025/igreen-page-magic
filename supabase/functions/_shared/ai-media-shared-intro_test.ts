import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { olaIntroSlotCandidates } from "./ai-media-shared-intro.ts";

Deno.test("olaIntroSlotCandidates — ptbr4 primeiro, legado depois", () => {
  assertEquals(olaIntroSlotCandidates("maria"), [
    "intro:ola:ptbr4:maria",
    "intro:ola:maria",
  ]);
  assertEquals(olaIntroSlotCandidates(""), []);
});
