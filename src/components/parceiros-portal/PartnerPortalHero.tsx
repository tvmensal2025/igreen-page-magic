import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import BrandLogo from "@/components/common/BrandLogo";

export function PartnerPortalHero({
  partnerName,
}: {
  partnerName: string;
}) {
  return (
    <header className="pt-8 pb-6 px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-5xl mx-auto text-center"
      >
        <BrandLogo className="h-9 sm:h-11 mx-auto mb-6 brightness-110" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-400/80 font-medium mb-3">
          Portal do parceiro
        </p>
        <h1 className="font-heading text-3xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1]">
          {partnerName}
        </h1>
        <p className="mt-3 text-sm sm:text-base text-emerald-100/70 max-w-xl mx-auto leading-relaxed">
          Seus leads em tempo real — mesmo acompanhamento automático por ~1 ano
          (WhatsApp, SMS e ligação).
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-amber-200/70 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
          <Lock className="h-3 w-3" />
          Link privado — não compartilhe
        </p>
      </motion.div>
    </header>
  );
}
