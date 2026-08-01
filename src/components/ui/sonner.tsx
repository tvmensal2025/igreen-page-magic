import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner } from "sonner";
import { toast } from "@/lib/toastSonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Usa o ThemeContext do app (não next-themes) — evita theme=system misturado. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      duration={8000}
      toastOptions={{
        duration: 8000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
