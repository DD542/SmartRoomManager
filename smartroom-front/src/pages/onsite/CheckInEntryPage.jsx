import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarCheck, CircleCheck } from 'lucide-react';
import { listBookings } from '../../api/bookings';
import { getRoomRules } from '../../api/rooms';
import { Badge } from '../../components/ui/Badge';
import { useAsync } from '../../hooks/useAsync';
import { fmtTime } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';

/**
 * Entrée du check-in, sans identifiant.
 *
 * L'onglet « Check-in » de la barre mobile pointait sur `bk-1001` — un
 * identifiant de maquette. Chaque appui menait donc à « booking_id doit être
 * un identifiant valide », sur mobile, où cet onglet est l'un des cinq.
 *
 * On ne peut pas valider sa présence « en général » : il faut une réservation.
 * Cet écran la trouve — celle du jour, la plus proche de maintenant — et passe
 * la main. Quand il y en a plusieurs, il les propose plutôt que d'en choisir
 * une à la place de l'utilisateur.
 */
const MINUTE = 60_000;

export default function CheckInEntryPage() {
  useEffect(() => {
    document.title = 'Valider ma présence — SmartRoom Manager';
  }, []);

  const bookings = useAsync(() => {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    const fin = new Date(debut.getTime() + 86_400_000);
    return listBookings({ status: 'confirmee', from: debut, to: fin });
  }, []);

  const maintenant = Date.now();
  const dujour = (bookings.data ?? [])
    .filter((item) => new Date(item.end).getTime() > maintenant - 15 * MINUTE)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  /**
   * Durée de fenêtre des réservations déjà commencées, par identifiant.
   *
   * Elle n'est demandée que pour celles-là : avant le début, la fenêtre est
   * fermée et son heure d'ouverture est le début lui-même — aucun appel
   * n'apprendrait quoi que ce soit. Une réservation commencée, en revanche,
   * peut avoir vu sa fenêtre passer, et seule la règle de la salle le dit.
   */
  const [fenetres, setFenetres] = useState({});
  const commencees = dujour.filter((item) => new Date(item.start).getTime() <= maintenant);
  const aResoudre = commencees.filter((item) => fenetres[item.id] === undefined);
  const cle = aResoudre.map((item) => item.id).join(',');

  useEffect(() => {
    if (!cle) return undefined;
    let vivant = true;

    Promise.all(
      cle.split(',').map(async (identifiant) => {
        const item = commencees.find((ligne) => ligne.id === identifiant);
        const regles = await getRoomRules(item.roomId ?? item.room?.id);
        return [identifiant, regles.checkinWindowMin ?? 10];
      }),
    )
      .then((paires) => {
        if (vivant) setFenetres((actuel) => ({ ...actuel, ...Object.fromEntries(paires) }));
      })
      // Une règle qu'on n'a pas pu lire ne doit pas vider l'écran : la ligne
      // reste, sans étiquette, et la fiche de validation tranchera.
      .catch(() => {});

    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  /** Ce que le serveur accepte : `[début, début + fenêtre)`. */
  const etat = (item) => {
    const debut = new Date(item.start).getTime();
    if (debut > maintenant) return { ouverte: false, ouvreA: item.start };

    const fenetre = fenetres[item.id];
    if (fenetre === undefined) return { ouverte: null };
    return { ouverte: maintenant < debut + fenetre * MINUTE };
  };

  // Celle qu'on peut valider passe devant. Le tri par heure de début suffisait
  // tant qu'une seule fenêtre pouvait s'ouvrir à la fois.
  const ordonnees = [...dujour].sort(
    (a, b) => (etat(b).ouverte === true) - (etat(a).ouverte === true),
  );

  // Une seule réservation à valider : l'écran n'a rien à demander.
  if (dujour.length === 1) return <Navigate to={`/app/check-in/${dujour[0].id}`} replace />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Valider ma présence"
        subtitle="Choisissez la réservation dans laquelle vous vous trouvez."
      />

      <AsyncBoundary
        status={bookings.status}
        error={bookings.error}
        onRetry={bookings.reload}
        skeleton={<Skeleton className="h-40 w-full" />}
      >
        {dujour.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Aucune réservation à valider aujourd’hui"
            description="La validation de présence s’ouvre le jour de la réunion, autour de son début."
            action={
              <Button to="/app/reservations" variant="secondary">
                Voir mes réservations
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {ordonnees.map((item) => {
              const { ouverte, ouvreA } = etat(item);
              return (
                <Card key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-content">{item.title}</span>
                    <span className="block text-xs text-content-muted">
                      {item.room?.name} • {fmtTime(item.start)} – {fmtTime(item.end)}
                    </span>
                  </span>

                  {/* Deux boutons identiques dont l'un mène à une fenêtre
                      fermée pour six heures : le choix se faisait à l'aveugle. */}
                  {ouverte === true && <Badge tone="success">Ouverte</Badge>}
                  {ouverte === false && ouvreA && (
                    <Badge tone="default">Ouvre à {fmtTime(ouvreA)}</Badge>
                  )}
                  {ouverte === false && !ouvreA && (
                    <Badge tone="warning">Fenêtre dépassée</Badge>
                  )}

                  <Button
                    size="sm"
                    icon={CircleCheck}
                    variant={ouverte === true ? 'primary' : 'secondary'}
                    to={`/app/check-in/${item.id}`}
                  >
                    Valider
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
