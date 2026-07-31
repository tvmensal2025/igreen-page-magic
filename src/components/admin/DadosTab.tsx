import { useEffect, useState } from "react";
import { Camera, Settings, Globe, Save, Bot, Loader2, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  GRADUACAO_OPTIONS,
  graduacaoDisplay,
  careerBonusPercent,
} from "@/features/produtos/acompanhamento/greenCommission";
import { useGreenSettings, useSaveGreenProfile } from "@/features/produtos/acompanhamento/greenHooks";
import { SyncAllPanel } from "@/components/admin/SyncAllPanel";
import { buildClubCadastroUrl } from "@/lib/clubCadastroUrl";

interface DadosTabProps {
  form: {
    name: string;
    display_name: string;
    license: string;
    phone: string;
    notification_phone: string;
    igreen_id: string;
    cadastro_url: string;
    licenciada_cadastro_url: string;
    club_cadastro_url: string;
    facebook_pixel_id: string;
    google_analytics_id: string;
    portal_kind: "digital" | "autoconexao";
  };
  photoPreview: string | null;
  saving: boolean;
  onFormChange: (updates: Record<string, string>) => void;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: (e: React.FormEvent) => void;
  userId: string;
}

export function DadosTab({ form, photoPreview, saving, onFormChange, onPhotoChange, onSave, userId }: DadosTabProps) {
  const { toast } = useToast();

  // ─── Nome da IA (consultants.assistant_name) ──────────────────────────
  // Fonte ÚNICA usada por toda a plataforma (edge functions, fluxos, alertas).
  // O onboarding grava aqui; aqui o consultor pode trocar a qualquer momento.
  const [personaName, setPersonaName] = useState<string>("");
  const [personaLoading, setPersonaLoading] = useState<boolean>(true);
  const [personaSaving, setPersonaSaving] = useState<boolean>(false);


  // ─── Graduação Green (consultant_commission_settings) ──────────────────
  const { data: greenSettings } = useGreenSettings(userId);
  const saveGreenProfile = useSaveGreenProfile(userId);
  const [graduacao, setGraduacao] = useState<string>("licenciado");

  useEffect(() => {
    if (greenSettings?.graduacao) setGraduacao(greenSettings.graduacao);
  }, [greenSettings?.graduacao]);

  const gradInfo = graduacaoDisplay(graduacao);
  const bonusPct = careerBonusPercent(graduacao);
  const exemploFatura = 300;
  const bonusExemplo = (exemploFatura * bonusPct) / 100;

  const formatBonus = (pct: number) =>
    pct.toLocaleString("pt-BR", { minimumFractionDigits: pct % 1 ? 1 : 0, maximumFractionDigits: 1 });

  const saveGraduacao = async (value: string) => {
    if (!userId) return;
    setGraduacao(value);
    try {
      // Zera códigos CP extras legados — CP oficial = só igreen_id do perfil.
      await saveGreenProfile.mutateAsync({ graduacao: value, cadastroIgreenIds: [] });
      const info = graduacaoDisplay(value);
      toast({
        title: "✅ Graduação salva",
        description: `${info.label} · +${formatBonus(info.bonusPct)}% carreira`,
        duration: 1800,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Erro ao salvar graduação", description: msg, variant: "destructive" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      // Lê assistant_name diretamente da tabela consultants (fonte única).
      // Migração transparente: se estiver vazio mas houver persona_name em
      // ai_agent_config (legado), usa esse valor como inicial.
      const { data: c } = await supabase
        .from("consultants")
        .select("assistant_name")
        .eq("id", userId)
        .maybeSingle();
      let nm = (c as any)?.assistant_name?.trim() || "";
      if (!nm) {
        const { data: legacy } = await supabase
          .from("ai_agent_config")
          .select("persona_name")
          .eq("consultant_id", userId)
          .maybeSingle();
        nm = (legacy as any)?.persona_name?.trim() || "";
      }
      if (cancelled) return;
      if (nm) setPersonaName(nm);
      setPersonaLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Salva SÓ quando o consultor clica em "Salvar" (nunca ao sair do campo).
  // Antes o onBlur gravava um nome pela metade enquanto ele ainda digitava.
  const savePersonaName = async () => {
    if (!userId) return;
    const trimmed = personaName.trim();
    if (trimmed.length < 2) {
      toast({
        title: "Nome muito curto",
        description: "O nome da sua IA precisa ter pelo menos 2 letras.",
        variant: "destructive",
      });
      return;
    }
    setPersonaSaving(true);
    try {
      // Grava em consultants.assistant_name — fonte única usada pelas edges.
      const { error } = await supabase
        .from("consultants")
        .update({ assistant_name: trimmed })
        .eq("id", userId);
      if (error) throw error;
      // Mantém ai_agent_config.persona_name sincronizado (compat legado).
      const { data: existing } = await supabase
        .from("ai_agent_config")
        .select("id")
        .eq("consultant_id", userId)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("ai_agent_config").update({ persona_name: trimmed }).eq("id", existing.id);
      } else {
        await supabase.from("ai_agent_config").insert({ consultant_id: userId, persona_name: trimmed, enabled: true });
      }
      setPersonaName(trimmed);
      toast({ title: "✅ Nome da IA salvo", description: `Sua IA agora se chama "${trimmed}".`, duration: 1800 });
      // Só regenera se Zap já estiver conectado.
      try {
        const { maybeBootstrapConsultantIdentity } = await import(
          "@/lib/consultantIdentityBootstrap"
        );
        void maybeBootstrapConsultantIdentity({ consultantId: userId, force: true });
      } catch (bootErr) {
        console.warn("[identity-bootstrap] após nome IA:", bootErr);
      }
    } catch (e: any) {
      const raw = e?.message || String(e);
      const friendly = /reservado/i.test(raw)
        ? `O nome "${trimmed}" já é a IA de outro consultor. Escolha um nome só seu (ex.: Bia, Lara, Nina).`
        : raw;
      toast({ title: "Erro ao salvar nome da IA", description: friendly, variant: "destructive", duration: 8000 });
    } finally {
      setPersonaSaving(false);
    }
  };




  // Auto-save do portal_kind quando o consultor clica no radio.
  // Sem isso, o consultor escolhia "Autoconexão" mas se não clicasse "Salvar"
  // depois, o banco continuava em "digital" e o cadastro ia pro Portal 1 errado.
  const persistPortalKind = async (kind: "digital" | "autoconexao", cadastro_url: string) => {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from("consultants")
        .update({ portal_kind: kind, cadastro_url })
        .eq("id", userId);
      if (error) throw error;
      toast({
        title: kind === "autoconexao" ? "✓ Portal Autoconexão ativo" : "✓ Portal Conta de Energia ativo",
        description: "Mudança aplicada — novos cadastros vão pelo portal escolhido.",
        duration: 1800,
      });
    } catch (e: any) {
      toast({
        title: "Erro ao salvar portal",
        description: e?.message || String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={onSave} className="space-y-6">
      {/* Photo Section */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <Camera className="w-5 h-5 text-primary" /> Sua Foto
        </h3>
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="relative group">
            {photoPreview ? (
              <img src={photoPreview} alt="Foto" className="w-28 h-28 rounded-2xl object-cover border-2 border-border group-hover:border-primary transition-colors" />
            ) : (
              <div className="w-28 h-28 rounded-2xl bg-secondary flex items-center justify-center border-2 border-dashed border-border">
                <Camera className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 w-full">
            <Input type="file" accept="image/*" onChange={onPhotoChange} className="bg-secondary border-border" />
            <p className="text-xs text-muted-foreground mt-2">JPG ou PNG, recomendado 400×400px</p>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" /> Informações
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm text-muted-foreground">Nome completo</Label>
            <Input id="name" value={form.name} onChange={(e) => {
              const newName = e.target.value;
              const slug = newName.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
              onFormChange({ name: newName, license: slug });
            }} placeholder="Seu nome" className="bg-secondary border-border" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="license" className="text-sm text-muted-foreground">Endereço da licença</Label>
            <Input id="license" value={form.license} readOnly className="bg-secondary/50 border-border text-muted-foreground cursor-not-allowed" />
            <p className="text-xs text-muted-foreground">Gerado automaticamente a partir do nome</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="display_name" className="text-sm text-muted-foreground">Como o lead vai te chamar nas mensagens</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => onFormChange({ display_name: e.target.value })}
              placeholder={form.name || "Ex.: Maria Silva"}
              className="bg-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">
              Aparece nas mensagens automáticas (ex.: &quot;Já avisei a Maria Silva&quot;). Use o seu próprio nome — nunca o de outro consultor. Se deixar em branco, usamos o nome completo acima.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-sm text-muted-foreground">WhatsApp principal (IA + divulgação)</Label>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
              <Input
                id="phone"
                value={form.phone.replace(/^55/, "")}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                  onFormChange({ phone: raw ? `55${raw}` : "" });
                }}
                placeholder="11989000650"
                className="bg-secondary border-border rounded-l-none"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">Número onde {personaName || "sua IA"} atende seus leads</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notification_phone" className="text-sm text-muted-foreground">WhatsApp para alertas (humano)</Label>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
              <Input
                id="notification_phone"
                value={form.notification_phone.replace(/^55/, "")}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                  onFormChange({ notification_phone: raw ? `55${raw}` : "" });
                }}
                placeholder="11989000650"
                className="bg-secondary border-border rounded-l-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">Receberá 🎉 novos clientes interessados e 🆘 pedidos de atendimento humano. Pode ser o mesmo número.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="igreen_id" className="text-sm text-muted-foreground">ID iGreen</Label>
            <Input id="igreen_id" value={form.igreen_id} onChange={(e) => {
              const id = e.target.value;
              // Portal 2 (Autoconexão) é o padrão único hoje. O link de cadastro
              // sempre aponta para o Autoconexão. (O Portal 1/digital continua no
              // código, mas a escolha foi removida da interface.)
              const url = id ? `https://green.igreenenergy.com.br/autoconexao/?id=${id}` : "";
              onFormChange({
                igreen_id: id,
                portal_kind: "autoconexao",
                cadastro_url: url,
                licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : "",
                club_cadastro_url: buildClubCadastroUrl(id),
              });
              if (id) void persistPortalKind("autoconexao", url);
            }} placeholder="ex: 126928" className="bg-secondary border-border" />
          </div>
        </div>

        {/*
          Seletor de Portal (Conta de Energia / Autoconexão) REMOVIDO da UI.
          Hoje só o Portal 2 (Autoconexão) está ativo, então o campo de dados
          fica mais limpo e o link já vem direto do Autoconexão. O código do
          Portal 1 (digital) e a função persistPortalKind seguem preservados
          no projeto/histórico — se a empresa reativar o Portal 1, basta
          restaurar este bloco. Ver git para a versão completa do seletor.
        */}

        <div className="mt-4 space-y-2">
          <Label htmlFor="cadastro_url" className="text-sm text-muted-foreground">
            Link de cadastro
          </Label>
          <Input id="cadastro_url" value={form.cadastro_url} readOnly className="bg-secondary/50 border-border text-muted-foreground cursor-not-allowed" />
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="licenciada_cadastro_url" className="text-sm text-muted-foreground">Link de cadastro Licença</Label>
          <Input id="licenciada_cadastro_url" value={form.licenciada_cadastro_url} readOnly className="bg-secondary/50 border-border text-muted-foreground cursor-not-allowed" />
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="club_cadastro_url" className="text-sm text-muted-foreground">Link iGreen Club</Label>
          <Input
            id="club_cadastro_url"
            value={form.club_cadastro_url}
            readOnly
            className="bg-secondary/50 border-border text-muted-foreground cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground">
            Cadastro oficial no Club: <span className="font-mono">club.igreenenergy.com.br/?id=seu_id</span>
          </p>
        </div>
      </div>

      {/* Sua IA — nome da persona usada em todo o sistema */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" /> Sua IA
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Escolha o nome da sua atendente virtual. Esse nome aparece nas conversas com seus clientes interessados.
        </p>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="persona_name" className="text-sm text-muted-foreground">Nome da IA</Label>
          <div className="flex gap-2">
            <Input
              id="persona_name"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value.slice(0, 20))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void savePersonaName(); } }}
              placeholder="Como sua IA se chama?"
              className="bg-secondary border-border"
              disabled={personaLoading || personaSaving}
              maxLength={20}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={savePersonaName}
              disabled={personaLoading || personaSaving || personaName.trim().length < 2}
              className="shrink-0"
            >
              {personaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Digite à vontade — só é salvo quando você clicar em <strong>Salvar</strong>. Esse nome aparece em todas as conversas com seus leads.
          </p>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={async () => {
              if (!userId) return;
              const { maybeBootstrapConsultantIdentity } = await import("@/lib/consultantIdentityBootstrap");
              toast({ title: "Gerando voz…", description: "Áudios e ligações com o nome da sua IA.", duration: 2500 });
              const r = await maybeBootstrapConsultantIdentity({ consultantId: userId, force: true });
              if (r.reason === "whatsapp_not_connected") {
                toast({
                  title: "Conecte o WhatsApp primeiro",
                  description: "A voz personalizada só é gerada com o Zap conectado.",
                  variant: "destructive",
                });
                return;
              }
              if (r.reason === "identity_incomplete") {
                toast({
                  title: "Complete nome, IA e telefone",
                  description: "Salve seus dados antes de gerar a voz.",
                  variant: "destructive",
                });
                return;
              }
              if (r.ok) {
                toast({
                  title: r.skipped ? "Já estava atualizado" : "Voz atualizada",
                  description: r.skipped
                    ? "Identidade sem mudança — nada a regenerar."
                    : "Áudios WhatsApp e ligações personalizados.",
                });
              } else {
                toast({
                  title: "Não foi possível gerar a voz",
                  description: r.error || "Tente de novo em instantes.",
                  variant: "destructive",
                });
              }
            }}
          >
            Atualizar voz com meu nome
          </Button>

        </div>
      </div>

      {/* Graduação Green — alimenta o bônus de carreira da comissão */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-primary" /> Plano de Carreira
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Sua graduação na iGreen. O bônus de carreira soma ao recorrente (CP/CI) nos cálculos Green. Cliente direto (CP) usa só o ID iGreen do seu perfil.
        </p>

        {/* Valor do bônus — sempre visível junto da graduação */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 mb-4">
          <p className="text-sm font-semibold text-foreground">
            {gradInfo.label} · +{formatBonus(bonusPct)}% carreira
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Exemplo: fatura de R$ {exemploFatura.toLocaleString("pt-BR")} → +R$ {bonusExemplo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês só de carreira
          </p>
        </div>

        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="graduacao" className="text-sm text-muted-foreground">Graduação atual</Label>
            <Select
              value={graduacao}
              onValueChange={saveGraduacao}
              disabled={saveGreenProfile.isPending}
            >
              <SelectTrigger id="graduacao" className="bg-secondary border-border">
                <SelectValue placeholder="Selecione sua graduação" />
              </SelectTrigger>
              <SelectContent>
                {GRADUACAO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label} (+{formatBonus(o.bonusPct)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {saveGreenProfile.isPending ? "Salvando…" : "Salvo automaticamente ao selecionar. Escala oficial Conexão Green."}
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">ID iGreen do perfil (único para CP)</p>
            <p className="text-sm font-semibold text-foreground font-mono mt-0.5">
              {form.igreen_id?.trim() || "— preencha o ID iGreen nos dados acima —"}
            </p>
          </div>
        </div>
      </div>

      {/* Pixel Tracking */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" /> Rastreamento das páginas
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Usados nas suas páginas (normal e premium). O rastreamento da plataforma continua ativo; o seu Facebook Pixel e o Google Analytics somam se preenchidos.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="facebook_pixel_id" className="text-sm text-muted-foreground">ID do Facebook Pixel (opcional)</Label>
            <Input id="facebook_pixel_id" value={form.facebook_pixel_id} onChange={(e) => onFormChange({ facebook_pixel_id: e.target.value })} placeholder="Ex: 123456789012345" className="bg-secondary border-border" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="google_analytics_id" className="text-sm text-muted-foreground">ID do Google Analytics (opcional)</Label>
            <Input id="google_analytics_id" value={form.google_analytics_id} onChange={(e) => onFormChange({ google_analytics_id: e.target.value })} placeholder="Ex: G-XXXXXXXXXX" className="bg-secondary border-border" />
          </div>
        </div>
      </div>

      {/* Sincronização sob demanda — substitui vários crons que foram desligados */}
      <SyncAllPanel />

      <Button type="submit" disabled={saving} className="w-full h-12 text-base font-bold rounded-xl gap-2" style={{ background: "var(--gradient-green)" }}>
        <Save className="w-5 h-5" />
        {saving ? "Salvando..." : "Salvar dados"}
      </Button>
    </form>
  );
}
