import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, X } from 'lucide-react';
import { getBooking } from '../../api/bookings';
import { checkIn, declareLate, getCheckInWindow } from '../../api/checkin';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { fmtTime } from '../../utils/dates';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, Callout } from '../../components/ui/Card';
import { AsyncBoundary, Skeleton } from '../../components/ui/States';

/** Compte à rebours circulaire de la fenêtre de validation. */
function CountdownRing({ remainingMin, totalMin = 10 }) {
  const ratio = Math.max(0, Math.min(1, remainingMin / totalMin));
  const circumference = 2 * Math.PI * 46;

  return (
    <div className="relative mx-auto h-32 w-32">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="46" fill="none" stroke="#2C3850" strokeWidth="5" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={ratio > 0.3 ? '#5B9BFF' : '#FF8080'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-content">
          {String(Math.floor(remainingMin)).padStart(2, '0')}:00
        </span>
        <span className="text-xs text-content-muted">restantes</span>
      </div>
    </div>
  );
}

/** U-19 — Check-in sur place, pensé pour le mobile d'abord. */
export default function CheckInPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef([]);

  const booking = useAsync(() => getBooking(id), [id]);
  const checkWindow = useAsync(() => getCheckInWindow(id), [id]);

  useEffect(() => {
    document.title = 'Validation de présence — SmartRoom Manager';
  }, []);

  /** Sortie de l'écran : la validation est abandonnée, la réservation intacte. */
  const quit = () => navigate(`/app/reservations/${id}`);

  // Échap ferme l'écran, comme sur n'importe quelle surface modale de l'application.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') quit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const setDigit = (index, value) => {
    const clean = value.replace(/\D/g, '').slice(-1);
    setDigits((current) => current.map((digit, i) => (i === index ? clean : digit)));
    setError(null);
    if (clean && index < 3) inputs.current[index + 1]?.focus();
  };

  const validate = async () => {
    setPending(true);
    setError(null);
    try {
      const prefix = booking.data?.accessCode?.split('-')[0] ?? 'A';
      await checkIn(id, `${prefix}-${digits.join('')}`);
      toast.success('Présence validée', 'Bonne réunion !');
      navigate(`/app/reservations/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    // Étroit au téléphone — l'écran se tient à une main devant la porte —, plus
    // large ensuite : à 1280 px, une colonne de 24 rem au milieu d'un vide
    // n'était pas « mobile-first », c'était mobile-seulement.
    <div className="mx-auto w-full max-w-sm md:max-w-3xl">
      <AsyncBoundary
        status={booking.status}
        error={booking.error}
        onRetry={booking.reload}
        skeleton={<Skeleton className="h-96 w-full" />}
      >
        {booking.data && (
          <Card className="p-5">
            {/* Même en-tête que les surfaces modales de l'application : titre à
                gauche, sortie à droite. */}
            <header className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-content">Enregistrement</h1>
                <p className="text-xs text-content-muted">Validation de présence sur place</p>
              </div>
              <IconButton
                icon={X}
                label="Quitter la validation de présence"
                onClick={quit}
                className="shrink-0"
              />
            </header>

            {/* Une colonne au téléphone, deux à partir de 768 px : le décompte
                et le rappel du créneau à gauche, la saisie du code à droite. La
                même page, jamais deux versions. */}
            <div className="mt-4 md:grid md:grid-cols-2 md:items-start md:gap-6">
              <section>
                <CountdownRing remainingMin={checkWindow.data?.remainingMin ?? 10} />
                <p className="mt-2 text-center text-xs text-content-muted">
                  {checkWindow.data?.open
                    ? 'Fenêtre de validation ouverte'
                    : `Validation ouverte ${checkWindow.data?.windowMin ?? 10} minutes avant le début`}
                </p>

                <dl className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface-raised">
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-xs text-content-muted">Salle</dt>
                    <dd className="text-sm text-content">{booking.data.room?.name}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-xs text-content-muted">Créneau</dt>
                    <dd className="font-mono text-sm text-content">
                      {fmtTime(booking.data.start)} - {fmtTime(booking.data.end)}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>

            {booking.data.checkedIn ? (
              <Callout tone="success" icon={CheckCircle2} className="mt-5">
                Votre présence est déjà validée pour cette réservation.
              </Callout>
            ) : (
              <>
                <fieldset className="mt-5">
                  <legend className="text-center text-xs text-content-muted">
                    Saisissez le code affiché sur l’écran de la salle
                  </legend>
                  <div className="mt-3 flex justify-center gap-2">
                    {digits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(node) => {
                          inputs.current[index] = node;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        aria-label={`Chiffre ${index + 1} du code d’accès`}
                        onChange={(event) => setDigit(index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Backspace' && !digit && index > 0) {
                            inputs.current[index - 1]?.focus();
                          }
                        }}
                        className="h-14 w-12 rounded-xl border border-line bg-surface-raised text-center font-mono text-xl text-content focus:border-accent focus:outline-none"
                      />
                    ))}
                  </div>
                </fieldset>

                {error && (
                  <Callout tone="danger" className="mt-4">
                    {error}
                  </Callout>
                )}

                <div className="mt-5 flex flex-col gap-2">
                  <Button
                    fullWidth
                    size="lg"
                    loading={pending}
                    disabled={digits.some((digit) => !digit)}
                    onClick={validate}
                  >
                    Valider mon arrivée
                  </Button>
                </div>

                <Callout tone="warning" icon={Clock} className="mt-4">
                  {checkWindow.data?.autoReleaseWarning ??
                    'La salle sera libérée si la présence n’est pas validée à temps.'}
                </Callout>

                <button
                  type="button"
                  onClick={async () => {
                    await declareLate(id);
                    toast.info('Retard signalé', 'La fenêtre de validation est prolongée de 10 minutes.');
                    checkWindow.reload();
                  }}
                  className="mx-auto mt-4 block text-xs text-accent transition hover:text-accent-hover"
                >
                  Je suis en retard
                </button>
              </>
            )}
              </section>
            </div>
          </Card>
        )}
      </AsyncBoundary>
    </div>
  );
}
