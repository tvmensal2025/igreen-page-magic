/**
 * Combobox — seletor com busca (single e multi-seleção).
 * Construído sobre Popover + Command (cmdk), padrão oficial shadcn/ui.
 *
 * Resolve o problema de listas grandes (ex: 30+ distribuidoras / centenas de
 * cidades) que poluíam a tela quando mostradas todas de uma vez em pills.
 * Agora o usuário busca e seleciona com teclado/mouse, sem scroll infinito.
 *
 * Uso single:
 *   <Combobox options={opts} value={v} onChange={setV} placeholder="Escolha..." />
 *
 * Uso multi:
 *   <Combobox multiple options={opts} value={arr} onChange={setArr} />
 */
import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto secundário cinza à direita (ex: UF, região). */
  hint?: string;
  /** Agrupa opções sob um cabeçalho (ex: tier de bônus). */
  group?: string;
  disabled?: boolean;
}

interface BaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
}

interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  /** Máximo de chips mostrados no botão antes de virar "+N". */
  maxChips?: number;
}

type Props = SingleProps | MultiProps;

export function Combobox(props: Props) {
  const {
    options,
    placeholder = "Selecione...",
    searchPlaceholder = "Buscar...",
    emptyText = "Nenhum resultado.",
    className,
    disabled,
  } = props;
  const [open, setOpen] = React.useState(false);

  const isMulti = props.multiple === true;
  const selectedValues = isMulti ? (props.value as string[]) : props.value ? [props.value as string] : [];

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  function toggle(v: string) {
    if (isMulti) {
      const arr = props.value as string[];
      const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      (props.onChange as (v: string[]) => void)(next);
    } else {
      const cur = props.value as string | null;
      (props.onChange as (v: string | null) => void)(cur === v ? null : v);
      setOpen(false);
    }
  }

  // Agrupa opções por group (mantém ordem de aparição).
  const groups = React.useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return Array.from(map.entries());
  }, [options]);

  const maxChips = isMulti ? (props as MultiProps).maxChips ?? 3 : 1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-auto min-h-10 py-2", className)}
        >
          <span className="flex flex-wrap gap-1 items-center text-left">
            {selectedValues.length === 0 && (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            {isMulti
              ? (
                <>
                  {selectedValues.slice(0, maxChips).map((v) => (
                    <Badge key={v} variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
                      {labelFor(v)}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggle(v); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggle(v); } }}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </Badge>
                  ))}
                  {selectedValues.length > maxChips && (
                    <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                      +{selectedValues.length - maxChips}
                    </Badge>
                  )}
                </>
              )
              : selectedValues.length > 0 && <span>{labelFor(selectedValues[0])}</span>}
          </span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(value, search) => {
            // value aqui é o label (passamos label como value do CommandItem).
            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map(([groupName, opts]) => (
              <CommandGroup key={groupName || "_"} heading={groupName || undefined}>
                {opts.map((o) => {
                  const selected = selectedValues.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.label} ${o.hint ?? ""}`}
                      disabled={o.disabled}
                      onSelect={() => toggle(o.value)}
                      className="flex items-center gap-2"
                    >
                      <Check className={cn("w-4 h-4 shrink-0", selected ? "opacity-100 text-primary" : "opacity-0")} />
                      <span className="flex-1">{o.label}</span>
                      {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
