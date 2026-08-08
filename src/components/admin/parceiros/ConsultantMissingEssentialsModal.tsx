import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, MessageSquareText, Save, AlertCircle } from "lucide-react";
import { normalizeBrazilPhone, validateBrazilPhone } from "@/lib/phone";
import { buildClubCadastroUrl } from "@/lib/clubCadastroUrl";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";

type MissingKind = "phone" | "igreen_id";

interface Props {
  open: boolean;
  consultantId: string;
  missing: MissingKind[];
  initialPhone?: string;
  initialIgreenId?: string;
  /** Não dá para fechar sem completar (Escape / clique fora). */
  blocking?: boolean;
  onClose?: () => void;
  onSaved: (next: { phone?: string; igreen_id?: string }) => void;
}

/**
 * Modal obrigatório quando falta WhatsApp/ID para banner, IA e recado do QR.
 */
export function ConsultantMissingEssentialsModal({
  open,
  consultantId,
  missing,
  initialPhone = "",
  initialIgreenId = "",
  blocking = true,
  onClose,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const needPhone = missing.includes("phone");
  const needIgreen = missing.includes("igreen_id");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [igreenId, setIgreenId] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhoneLocal(String(initialPhone || "").replace(/\D/g, "").replace(/^55/, ""));
    setIgreenId(String(initialIgreenId || "").replace(/\D/g, "").slice(0, 10));
    setAttempted(false);
  }, [open, initialPhone, initialIgreenId]);

  const phoneFull = useMemo(() => {
    const raw = phoneLocal.replace(/\D/g, "");
    return raw ? normalizeBrazilPhone(raw) : "";
  }, [phoneLocal]);

  const phoneErr = useMemo(() => {
    if (!needPhone) return null;
    if (!phoneFull) return "Digite o WhatsApp com DDD.";
    const v = validateBrazilPhone(phoneFull);
    return v.valid ? null : v.message || "WhatsApp inválido.";
  }, [needPhone, phoneFull]);

  const igreenErr = useMemo(() => {
    if (!needIgreen) return null;
    if (!igreenId || igreenId.length < 4) return "ID iGreen inválido (mínimo 4 dígitos).";
    return null;
  }, [needIgreen, igreenId]);

  const canSave = !phoneErr && !igreenErr && !saving;

  const handleSave = async () => {
    setAttempted(true);
    if (phoneErr || igreenErr) return;
    setSaving(true);
    try {
      const patch: Record<string, string | null> = {};
      if (needPhone) patch.phone = phoneFull;
      if (needIgreen) {
        patch.igreen_id = igreenId;
        patch.cadastro_url = `https://digital.igreenenergy.com.br/?id=${igreenId}&sendcontract=true`;
        patch.licenciada_cadastro_url = `https://expansao.igreenenergy.com.br/?id=${igreenId}&checkout=true`;
        patch.club_cadastro_url = buildClubCadastroUrl(igreenId);
      }
      const { error } = await supabase
        .from("consultants")
        .update(patch as never)
        .eq("id", consultantId);
      if (error) throw error;
      toast({
        title: "Dados salvos",
        description: "Agora o banner, a IA e o recado do QR já funcionam.",
      });
      onSaved({
        phone: needPhone ? phoneFull : undefined,
        igreen_id: needIgreen ? igreenId : undefined,
      });
    } catch (e: unknown) {
      toast({
        title: "Não foi possível salvar",
        description: toUserFacingError(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !blocking) onClose?.();
      }}
    >
      <DialogContent
        className="w-[calc(100%-1rem)] sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          if (blocking) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (blocking) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            Falta um dado importante
          </DialogTitle>
          <DialogDescription>
            Sem isso o lead escaneia o banner e a conversa não chega direito no
            seu WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Alert className="border-primary/20 bg-primary/5">
            <Bot className="h-4 w-4 text-primary" />
            <AlertTitle className="text-sm">Para que serve a IA?</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              A IA (ex.: Yasmin, Sol) atende o lead{" "}
              <strong>no seu número de WhatsApp</strong>. Ela responde dúvidas,
              pede a conta de luz e conduz o cadastro — no mesmo Zap do banner.
            </AlertDescription>
          </Alert>

          <Alert className="border-primary/20 bg-primary/5">
            <MessageSquareText className="h-4 w-4 text-primary" />
            <AlertTitle className="text-sm">O que é o recado do QR?</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              É a <strong>mensagem pronta</strong> que aparece no WhatsApp quando
              a pessoa aponta a câmera no banner (ex.: “Oi! Vi o banner e quero
              economizar…”). Sem WhatsApp cadastrado, o QR não sabe para quem
              mandar o recado.
            </AlertDescription>
          </Alert>
        </div>

        <div className="space-y-4 pt-1">
          {needPhone && (
            <div className="space-y-2">
              <Label htmlFor="essentials-phone" className="text-sm">
                Seu WhatsApp (com DDD)
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">+55</span>
                <Input
                  id="essentials-phone"
                  inputMode="tel"
                  placeholder="34999999999"
                  value={phoneLocal}
                  onChange={(e) =>
                    setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  className="bg-secondary"
                />
              </div>
              {attempted && phoneErr && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {phoneErr}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Use o celular que a IA e os leads vão falar. Pode ser o mesmo do
                chip Whapi/Evolution.
              </p>
            </div>
          )}

          {needIgreen && (
            <div className="space-y-2">
              <Label htmlFor="essentials-igreen" className="text-sm">
                ID iGreen
              </Label>
              <Input
                id="essentials-igreen"
                inputMode="numeric"
                placeholder="ex: 137238"
                value={igreenId}
                onChange={(e) =>
                  setIgreenId(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                className="bg-secondary"
              />
              {attempted && igreenErr && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {igreenErr}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Entra no link do banner: igreen.cloud/suas-iniciais/
                <strong>seu-id</strong>
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {!blocking && (
            <Button type="button" variant="outline" onClick={onClose}>
              Depois
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="gap-2"
          >
            {saving ? (
              "Salvando…"
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar e continuar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function missingBannerEssentials(opts: {
  phone?: string | null;
  igreenId?: string | null;
}): MissingKind[] {
  const out: MissingKind[] = [];
  const phone = String(opts.phone || "").replace(/\D/g, "");
  const id = String(opts.igreenId || "").replace(/\D/g, "");
  if (phone.length < 10) out.push("phone");
  if (id.length < 4) out.push("igreen_id");
  return out;
}
