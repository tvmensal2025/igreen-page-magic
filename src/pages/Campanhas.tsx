import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import {
  CampaignTemplate,
  DEFAULT_UBERLANDIA_TEMPLATE,
  slugify,
} from "@/lib/campaignTemplate";
import { CampaignTemplateCard } from "@/components/admin/campanhas/CampaignTemplateCard";
import { CampaignTemplateForm } from "@/components/admin/campanhas/CampaignTemplateForm";

type Draft = Omit<CampaignTemplate, "id" | "consultant_id" | "created_at" | "updated_at"> & { id?: string };

export default function Campanhas() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CampaignTemplate[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) {
        navigate("/auth");
        return;
      }
      setUserId(uid);
    })();
  }, [navigate]);

  useEffect(() => {
    if (!userId) return;
    loadAndSeed(userId);
     
  }, [userId]);

  async function loadAndSeed(uid: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("campaign_templates")
      .select("*")
      .eq("consultant_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar templates");
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      const { data: seeded, error: seedErr } = await supabase
        .from("campaign_templates")
        .insert({ ...DEFAULT_UBERLANDIA_TEMPLATE, consultant_id: uid })
        .select("*")
        .single();
      if (!seedErr && seeded) {
        setItems([seeded as CampaignTemplate]);
      } else {
        setItems([]);
      }
    } else {
      setItems(data as CampaignTemplate[]);
    }
    setLoading(false);
  }

  async function handleSave(draft: Draft): Promise<void> {
    if (!userId) return;
    const payload = {
      ...draft,
      utm_campaign: draft.utm_campaign || slugify(draft.name),
      consultant_id: userId,
    };
    if (draft.id) {
      const { id, ...rest } = payload as any;
      const { error } = await supabase.from("campaign_templates").update(rest).eq("id", draft.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Template atualizado");
    } else {
      const { id: _omit, ...insertPayload } = payload as any;
      const { error } = await supabase.from("campaign_templates").insert(insertPayload);
      if (error) { toast.error(error.message); return; }
      toast.success("Template criado");
    }
    if (userId) await loadAndSeed(userId);
  }

  async function handleDelete(t: CampaignTemplate) {
    if (!confirm(`Apagar o template "${t.name}"?`)) return;
    const { error } = await supabase.from("campaign_templates").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Template apagado");
    setItems((prev) => prev.filter((x) => x.id !== t.id));
  }

  function handleDuplicate(t: CampaignTemplate) {
    const { id, consultant_id, created_at, updated_at, ...rest } = t;
    setEditing({ ...rest, name: `${t.name} (cópia)` });
    setFormOpen(true);
  }

  function handleEdit(t: CampaignTemplate) {
    const { consultant_id, created_at, updated_at, ...rest } = t;
    setEditing(rest);
    setFormOpen(true);
  }

  function handleNew() {
    setEditing(null);
    setFormOpen(true);
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/40 bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-heading font-bold flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" /> Templates de Campanha
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Modelos reutilizáveis para Meta Ads — copie e cole no Ads Manager.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={handleNew} className="gap-1.5">
            <Plus className="w-4 h-4" /> Novo
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Nenhum template ainda. Clique em <strong>Novo</strong> para criar o primeiro.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((t) => (
              <CampaignTemplateCard
                key={t.id}
                template={t}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      <CampaignTemplateForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
