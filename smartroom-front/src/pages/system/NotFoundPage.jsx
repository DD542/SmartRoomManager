import { useEffect } from 'react';
import { CalendarCheck, Home } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ErrorPage } from '../../components/system/ErrorPage';

/** U-26 — Page introuvable (404). */
export default function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page introuvable — SmartRoom Manager';
  }, []);

  return (
    <ErrorPage
      code="404"
      title="Cette salle n’existe pas"
      description="La page demandée est introuvable ou a été déplacée. Elle a peut-être été supprimée avec la réservation associée."
      actions={
        <>
          <Button icon={Home} to="/app">
            Retour à l’accueil
          </Button>
          <Button variant="secondary" icon={CalendarCheck} to="/app/reservations">
            Voir mes réservations
          </Button>
        </>
      }
    />
  );
}
