import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildIntroSlotCandidates,
  buildStitchSlotCandidates,
} from "./wa-audio-stitch.ts";

const A2_SPEC = {
  baseSlot: "a2_audio_activate_name",
  introMode: "ola_greet" as const,
  genderedBody: true,
  bodyText: () => "",
};

const A2_NOME_ONLY = {
  baseSlot: "a2_audio_activate_name",
  introMode: "nome_only" as const,
  genderedBody: true,
  bodyText: () => "",
};

const A3_SPEC = {
  baseSlot: "a3_explain_with_buttons",
  introMode: "nome_only" as const,
  genderedBody: false,
  bodyText: () => "",
};

const A5_SPEC = {
  baseSlot: "a5_audio_club_benefits",
  introMode: "nome_only" as const,
  genderedBody: false,
  bodyText: () => "",
};

Deno.test("buildStitchSlotCandidates: A2 ola_greet usa ola8 (Olá+tudo bem + corpo)", () => {
  const slots = buildStitchSlotCandidates(A2_SPEC, "masculino", "lucas");
  assertEquals(slots, ["stitch:a2_audio_activate_name:ola8:masculino:lucas"]);
});

Deno.test("buildStitchSlotCandidates: A2 nome_only usa n5 (legado)", () => {
  const slots = buildStitchSlotCandidates(A2_NOME_ONLY, "masculino", "lucas");
  assertEquals(slots, ["stitch:a2_audio_activate_name:n5:masculino:lucas"]);
});

Deno.test("buildStitchSlotCandidates: A3 só n5 (nome PT-BR ancorado)", () => {
  const slots = buildStitchSlotCandidates(A3_SPEC, "feminino", "maria");
  assertEquals(slots, [
    "stitch:a3_explain_with_buttons:n5:x:maria",
  ]);
});

Deno.test("buildStitchSlotCandidates: A5 nome + clube", () => {
  const slots = buildStitchSlotCandidates(A5_SPEC, "masculino", "felipe");
  assertEquals(slots, [
    "stitch:a5_audio_club_benefits:n5:x:felipe",
  ]);
});

Deno.test("buildIntroSlotCandidates: ola ptbr4 (tudo bem) + nome ptbr3", () => {
  assertEquals(buildIntroSlotCandidates("nome", "felipe"), [
    "intro:nome:ptbr3:felipe",
  ]);
  assertEquals(buildIntroSlotCandidates("ola", "felipe"), [
    "intro:ola:ptbr4:felipe",
  ]);
});
