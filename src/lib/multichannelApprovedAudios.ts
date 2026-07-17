/**
 * Áudios multicanal aprovados (última geração validada).
 * Fonte: voice_audio_clips + MinIO · cópia local em /public/multichannel/
 *
 * 2a — gerados em 2026-07-16 ~19:11 UTC (último ajuste bem-vindo / bem-vinda).
 */

export type ApprovedCadenceAudio = {
  key: string;
  gender: "masculino" | "feminino";
  clipId: string;
  /** URL canônica (MinIO / voice_audio_clips) */
  audioUrl: string;
  /** Cópia no repo (fallback / prévia sem rede) */
  publicPath: string;
  generatedAt: string;
  label: string;
};

export const APPROVED_A2_AUDIOS: ApprovedCadenceAudio[] = [
  {
    key: "a2_audio_activate_name__feminino",
    gender: "feminino",
    clipId: "13a612d7-7ef6-4ccd-b3f1-9d0c1779c412",
    audioUrl:
      "https://igreen-minio.d9v63q.easypanel.host/igreen/public/media/multichannel-a2_audio_activate_name_feminino_1784229103848.mp3",
    publicPath: "/multichannel/a2/bem-vinda.mp3",
    generatedAt: "2026-07-16T19:11:44.214Z",
    label: "2a feminino · bem-vinda",
  },
  {
    key: "a2_audio_activate_name__masculino",
    gender: "masculino",
    clipId: "regen-2026-07-17-masculino-v3-fonetico",
    audioUrl:
      "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/tts-cache/multichannel-a2/masculino-1784308670894.mp3",
    publicPath: "/multichannel/a2/bem-vindo.mp3",
    generatedAt: "2026-07-17T17:17:51.000Z",
    label: "2a masculino · bem-vindo (regen v3 fonético)",
  },
];

/** Injeta URLs/clip IDs aprovados do 2a na biblioteca (sobrescreve versões antigas do 2a). */
export function mergeApprovedA2Audios(lib: {
  audioUrls: Record<string, string>;
  audioClipIds: Record<string, string>;
  approved: Record<string, boolean>;
}): {
  audioUrls: Record<string, string>;
  audioClipIds: Record<string, string>;
  approved: Record<string, boolean>;
} {
  const audioUrls = { ...lib.audioUrls };
  const audioClipIds = { ...lib.audioClipIds };
  for (const a of APPROVED_A2_AUDIOS) {
    audioUrls[a.key] = a.audioUrl;
    audioClipIds[a.key] = a.clipId;
  }
  // Compat: chave sem sufixo = feminino (prévia padrão do painel)
  const fem = APPROVED_A2_AUDIOS.find((a) => a.gender === "feminino");
  if (fem) {
    audioUrls.a2_audio_activate_name = fem.audioUrl;
    audioClipIds.a2_audio_activate_name = fem.clipId;
  }
  return {
    audioUrls,
    audioClipIds,
    approved: { ...lib.approved, a2_audio_activate_name: true },
  };
}
