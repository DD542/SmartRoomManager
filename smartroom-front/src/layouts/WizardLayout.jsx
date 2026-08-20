import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Stepper } from '../components/ui/Stepper';
import { BookingProvider } from '../hooks/useBooking';

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
 * Cadre du tunnel de réservation : le stepper reste visible du besoin à la
 * confirmation, et le brouillon vit dans BookingProvider monté ici.
 */
export default function WizardLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const step = currentStep(pathname);

  return (
    <BookingProvider>
      <div className="flex flex-col gap-6">
        <Stepper
          steps={WIZARD_STEPS}
          current={step}
          onGoTo={(target, position) => {
            if (position === 1) navigate('/app/reservation/besoin');
            if (position === 2) navigate('/app/reservation/salles');
          }}
        />
        <Outlet />
      </div>
    </BookingProvider>
  );
}
