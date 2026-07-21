import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users } from "lucide-react";
import { useManagedConsultants } from "@/hooks/useManagedConsultants";

interface Props {
  userId: string;
  value: string;
  onChange: (id: string) => void;
}

export function AdAccountSwitcher({ userId, value, onChange }: Props) {
  const { data: accounts = [] } = useManagedConsultants(userId);
  if (accounts.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Users className="w-3.5 h-3.5 text-muted-foreground" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full max-w-[220px] min-w-0 text-xs">
          <SelectValue placeholder="Conta de anúncio" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
