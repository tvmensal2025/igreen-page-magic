export type TourStep = {
  id: string;
  order_index: number;
  route: string;
  selector: string | null;
  title: string;
  body: string;
  cta_label: string | null;
  cta_href: string | null;
  is_active: boolean;
};

export type TourArticle = {
  id: string;
  category: string;
  title: string;
  body: string;
  video_url: string | null;
  related_tour_step_id: string | null;
  order_index: number;
  is_active: boolean;
};

export type TourProgress = {
  user_id: string;
  current_step: number;
  started_at: string;
  completed_at: string | null;
  dismissed_at: string | null;
};

export const ARTICLE_CATEGORIES = [
  "WhatsApp",
  "Campanhas",
  "CRM",
  "Cadência",
  "Pós-venda",
  "Textos e IA",
  "Financeiro",
] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];
