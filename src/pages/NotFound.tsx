import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { createLogger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import PageStatus from "@/components/common/PageStatus";

const logger = createLogger("NotFound");

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    logger.warn("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <PageStatus
      title="Página não encontrada"
      description="O endereço que você tentou acessar não existe ou foi movido."
    >
      <Button asChild variant="outline" className="rounded-xl">
        <a href="/">Voltar ao início</a>
      </Button>
    </PageStatus>
  );
};

export default NotFound;
