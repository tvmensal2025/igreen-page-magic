import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PasswordFieldProps = {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
  autoComplete?: string;
  className?: string;
  inputClassName?: string;
};

/**
 * Campo de senha com toggle olho — touch target ≥ 44px.
 */
export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  placeholder = "••••••••",
  required = true,
  minLength = 6,
  autoFocus,
  autoComplete,
  className,
  inputClassName,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  const resolvedAutoComplete =
    autoComplete ??
    (id.toLowerCase().includes("confirm") || id.toLowerCase().includes("new")
      ? "new-password"
      : "current-password");

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          name={name ?? id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoFocus={autoFocus}
          autoComplete={resolvedAutoComplete}
          className={cn(
            "h-12 rounded-xl bg-secondary/50 border-border text-base pr-12 placeholder:text-muted-foreground/50",
            inputClassName,
          )}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-h-11 min-w-11 flex items-center justify-center rounded-md"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
