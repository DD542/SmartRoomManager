import { useEffect } from 'react';
import { Home, LifeBuoy } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ErrorPage } from '../../components/system/ErrorPage';

/** U-26 — Accès refusé (403). */
export default function ForbiddenPage() {
  useEffect(() => {
    document.title = 'Accès refusé — SmartRoom Manager';
  }, []);

  return (
    <ErrorPage
      code="403"
      title="Accès refusé"
      description="Cette réservation appartient à un autre utilisateur, ou la salle demandée nécessite une autorisation du gestionnaire de site."
      actions={
        <>
          <Button icon={Home} to="/app">
            Retour à l’accueil
          </Button>
          <Button variant="secondary" icon={LifeBuoy} to="/app/aide">
            Demander un accès
          </Button>
        </>
      }
    />
  );
}
