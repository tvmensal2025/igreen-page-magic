// Mapeia o ID do vídeo (antigo Panda) para a URL pública do MinIO.
// Os vídeos foram baixados do Panda e hospedados no MinIO para evitar o
// bloqueio de domínio do player Panda (que só tocava no site original).

const MINIO_BASE = "https://igreen-minio.d9v63q.easypanel.host/igreen/conexao-videos";

/** URL do vídeo MP4 no MinIO. */
export function conexaoVideoUrl(videoId: string): string {
  return `${MINIO_BASE}/${videoId}.mp4`;
}

/** URL do poster (miniatura) local — leve, mostrado antes do play. */
export function conexaoPosterUrl(videoId: string): string {
  return `/videos/conexao-posters/${videoId}.webp`;
}
