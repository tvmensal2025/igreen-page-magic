export interface Consultant {
  id: string;
  name: string;
  license: string;
  phone: string;
  cadastro_url: string;
  photo_url: string | null;
  igreen_id: string | null;
  licenciada_cadastro_url: string | null;
  club_cadastro_url: string | null;
  facebook_pixel_id: string | null;
  google_analytics_id: string | null;
  created_at: string;
}
