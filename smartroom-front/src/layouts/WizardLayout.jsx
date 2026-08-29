import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Stepper } from '../components/ui/Stepper';
import { BookingProvider, useBooking } from '../hooks/useBooking';
import { PageTransition } from '../components/layout/PageTransition';

export const WIZARD_STEPS = [
  { id: 'criteres', label: 'Critères', path: '/app/reservation/besoin' },
  { id: 'selection', label: 'Sélection', path: '/app/reservation/salles' },
  { id: 'validation', label: 'Validation', path: '/app/reservation/salles/' },
  { id: 'confirmation', label: 'Confirmation', path: '/app/reservation/recapitulatif' },
];

/** Position de l'étape courante déduite de l'URL, pas d'un état dupliqué. */
function currentStep(pathname) {
  if (pathname.startsWith('/app/reservation/recapitulatif')) return 4;
  if (/\/app\/reservation\/salles\/[^/]+/.test(pathname)) return 3;
  if (pathname.startsWith('/app/reservation/salles')) return 2;
  if (pathname.startsWith('/app/reservation/conflit')) return 3;
  if (pathname.startsWith('/app/reservation/recurrente')) return 3;
  if (pathname.startsWith('/app/reservation/acces-exceptionnel')) return 3;
  return 1;
}

/**
 * Où mène le retour, depuis chaque étape.
 *
 * Une destination explicite plutôt que `navigate(-1)` : l'historique du
 * navigateur ne dit pas d'où l'on vient dans le tunnel. Un lien profond, un
 * rechargement, un retour depuis une salle consultée en chemin, et « une page
 * en arrière » ramène ailleurs qu'à l'étape précédente — parfois hors du
 * tunnel, parfois sur un écran qui vient de rediriger, ce qui boucle.
 *
 * L'étape 1 n'a pas de précédente : le retour y sort du tunnel, et c'est bien
 * un retour — celui qui annule la réservation en cours.
 */
export function retourDe(pathname, roomId) {
  const versLaSalle = roomId
    ? { to: `/app/reservation/salles/${roomId}`, label: 'Retour au créneau' }
    : { to: '/app/reservation/salles', label: 'Retour aux salles' };

  // Les trois écarts du tunnel — conflit, série, accès exceptionnel — se
  // rejoignent depuis le calendrier d'une salle : c'est là qu'ils ramènent.
  if (
    pathname.startsWith('/app/reservation/recapitulatif') ||
    pathname.startsWith('/app/reservation/conflit') ||
    pathname.startsWith('/app/reservation/recurrente') ||
    pathname.startsWith('/app/reservation/acces-exceptionnel')
  ) {
    return versLaSalle;
  }
  if (/\/app\/reservation\/salles\/[^/]+/.test(pathname)) {
    return { to: '/app/reservation/salles', label: 'Retour aux salles' };
  }
  if (pathname.startsWith('/app/reservation/salles')) {
    return { to: '/app/reservation/besoin', label: 'Retour au besoin' };
  }
  return { to: '/app', label: 'Quitter la réservation' };
}

/** Le lien de retour, dans le cadre, pour que chaque étape en ait un. */
function LienRetour({ pathname }) {
  // Rendu à l'intérieur de `BookingProvider` : le brouillon est là, et c'est
  // lui qui sait vers quelle salle revenir depuis le récapitulatif.
  const { draft } = useBooking();
  const retour = retourDe(pathname, draft?.roomId);

  return (
    <Link
      to={retour.to}
      // 44 px de haut : c'est une commande, prise au pouce en haut de l'écran.
      className="inline-flex min-h-[44px] w-fit items-center gap-1 text-xs text-content-muted transition hover:text-content"
    >
      <ChevronLeft size={14} aria-hidden="true" />
      {retour.label}
    </Link>
  );
}

/**
 * Cadre du tunnel de réservation : le stepper reste visible du besoin à la
 * confirmation, et le brouillon vit dans BookingProvider monté ici.
 *
 * Le retour est porté par le cadre et non par chaque écran : quatre étapes sur
 * cinq n'en avaient aucun, et l'utilisateur n'avait que le bouton du
 * navigateur — qui ne connaît pas le tunnel — pour revenir sur un choix.
 */
export default function WizardLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const step = currentStep(pathname);

  return (
    <BookingProvider>
      <div className="flex flex-col gap-4">
        <LienRetour pathname={pathname} />

        <Stepper
          steps={WIZARD_STEPS}
          current={step}
          onGoTo={(target, position) => {
            if (position === 1) navigate('/app/reservation/besoin');
            if (position === 2) navigate('/app/reservation/salles');
          }}
        />
        {/* Chaque étape du tunnel glisse à la place de la précédente : le
            repère visuel du passage compte plus ici qu'ailleurs, l'écran
            changeant sans que l'adresse change de forme. */}
        <PageTransition>
          <Outlet />
        </PageTransition>
      </div>
    </BookingProvider>
  );
}
