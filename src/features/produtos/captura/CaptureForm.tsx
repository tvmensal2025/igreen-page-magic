// =============================================================================
// Captura por família de produto — Formulário
// =============================================================================
// Renderiza o formulário de captura correto conforme a família do produto.
// Energia (Green/Solar/Livre) NÃO usa este formulário: reaproveita o pipeline
// de OCR/portal/OTP já existente em customers.* — aqui só exibimos um aviso.
//
// Os dados validados (Zod) são entregues via onSubmit para gravar em
// sales.capture_data. A validação de cada família vive em schemas.ts.
// =============================================================================

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { ProductFamily } from "../catalogo/types";
import type { CaptureData } from "../vendas/types";
import {
  placasCaptureSchema,
  segurosCaptureSchema,
  telecomCaptureSchema,
  type PlacasCaptureInput,
  type SegurosCaptureInput,
  type TelecomCaptureInput,
} from "./schemas";

interface CaptureFormProps {
  family: ProductFamily;
  defaultValues?: CaptureData;
  onSubmit: (data: CaptureData) => void;
  submitting?: boolean;
}

export function CaptureForm({ family, defaultValues, onSubmit, submitting }: CaptureFormProps) {
  switch (family) {
    case "telecom":
      return <TelecomForm defaultValues={defaultValues} onSubmit={onSubmit} submitting={submitting} />;
    case "seguros":
      return <SegurosForm defaultValues={defaultValues} onSubmit={onSubmit} submitting={submitting} />;
    case "placas":
      return <PlacasForm defaultValues={defaultValues} onSubmit={onSubmit} submitting={submitting} />;
    case "energia":
      return (
        <p className="text-sm text-muted-foreground">
          Produtos de energia usam o fluxo de cadastro com foto da conta de luz (OCR) e
          validação no portal. A captura acontece pelo WhatsApp, não por este formulário.
        </p>
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Esta família de produto não exige captura de dados adicionais.
        </p>
      );
  }
}

// ─── Telecom ────────────────────────────────────────────────────────────────
const TELECOM_PLANS = ["Start", "Mega", "Giga", "Ultra", "Infinity"];

function TelecomForm({
  defaultValues,
  onSubmit,
  submitting,
}: Omit<CaptureFormProps, "family">) {
  const form = useForm<TelecomCaptureInput>({
    resolver: zodResolver(telecomCaptureSchema),
    defaultValues: {
      plano: "",
      portabilidade: false,
      numero: "",
      tipo_chip: "fisico",
      ...(defaultValues as Partial<TelecomCaptureInput>),
    },
  });

  const portabilidade = form.watch("portabilidade");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => onSubmit(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="plano"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Plano</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o plano" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TELECOM_PLANS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tipo_chip"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de chip</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="fisico">Chip físico</SelectItem>
                  <SelectItem value="esim">eSIM</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="portabilidade"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <FormLabel className="!mt-0">Portabilidade (manter número)</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        {portabilidade && (
          <FormField
            control={form.control}
            name="numero"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número para portabilidade</FormLabel>
                <FormControl>
                  <Input placeholder="11999998888" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <SubmitButton submitting={submitting} />
      </form>
    </Form>
  );
}

// ─── Seguros ──────────────────────────────────────────────────────────────
function SegurosForm({
  defaultValues,
  onSubmit,
  submitting,
}: Omit<CaptureFormProps, "family">) {
  const form = useForm<SegurosCaptureInput>({
    resolver: zodResolver(segurosCaptureSchema),
    defaultValues: {
      placa: "",
      modelo: "",
      ano: new Date().getFullYear(),
      plano: "basic",
      ...(defaultValues as Partial<SegurosCaptureInput>),
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => onSubmit(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="placa"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Placa</FormLabel>
              <FormControl>
                <Input placeholder="ABC1D23" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="modelo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Modelo do veículo</FormLabel>
              <FormControl>
                <Input placeholder="Ex.: Honda Civic" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="ano"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ano</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  {...field}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="plano"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Plano</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o plano" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="infinite">Infinite</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <SubmitButton submitting={submitting} />
      </form>
    </Form>
  );
}

// ─── Placas ───────────────────────────────────────────────────────────────
function PlacasForm({
  defaultValues,
  onSubmit,
  submitting,
}: Omit<CaptureFormProps, "family">) {
  const form = useForm<PlacasCaptureInput>({
    resolver: zodResolver(placasCaptureSchema),
    defaultValues: {
      consumo_kwh: undefined as unknown as number,
      tipo_imovel: "residencial",
      financiamento: false,
      ...(defaultValues as Partial<PlacasCaptureInput>),
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => onSubmit(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="consumo_kwh"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Consumo médio (kWh/mês)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Ex.: 500"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tipo_imovel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de imóvel</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="residencial">Residencial</SelectItem>
                  <SelectItem value="comercial">Comercial</SelectItem>
                  <SelectItem value="industrial">Industrial</SelectItem>
                  <SelectItem value="rural">Rural</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="financiamento"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <FormLabel className="!mt-0">Tem interesse em financiamento</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <SubmitButton submitting={submitting} />
      </form>
    </Form>
  );
}

function SubmitButton({ submitting }: { submitting?: boolean }) {
  return (
    <Button type="submit" className="w-full gap-2" disabled={submitting}>
      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {submitting ? "Salvando..." : "Salvar captura"}
    </Button>
  );
}
