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

/**
 * Compte à rebours circulaire de la fenêtre de validation.
 *
 * Il affichait `MM:00` — les secondes étaient une constante. Associé à un
 * calcul fait une seule fois au montage, cela donnait un chronomètre
 * parfaitement immobile, qui annonçait dix minutes restantes aussi longtemps
 * qu'on le regardait.
 */
function CountdownRing({ remainingSec, totalSec, legende, etiquette }) {
  const ratio = Math.max(0, Math.min(1, remainingSec / totalSec));
  const circumference = 2 * Math.PI * 46;
  // `MM:SS` débordait dès qu'on dépassait l'heure : une réservation du matin
  // consultée la veille au soir affichait « 375:52 », qui ne se lit pas.
  const total = Math.floor(remainingSec);
  const heures = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secondes = String(total % 60).padStart(2, '0');
  const affichage = heures > 0 ? `${heures}:${minutes}:${secondes}` : `${minutes}:${secondes}`;

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
        <span
          className={heures > 0 ? 'font-mono text-xl text-content' : 'font-mono text-2xl text-content'}
          role="timer"
          aria-label={etiquette}
        >
          {affichage}
        </span>
        <span className="text-xs text-content-muted">{legende}</span>
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
  const [retardOuvert, setRetardOuvert] = useState(false);
  const [retardMin, setRetardMin] = useState('');
  const inputs = useRef([]);

  const booking = useAsync(() => getBooking(id), [id]);
  const checkWindow = useAsync(() => getCheckInWindow(id), [id]);

  // Une seconde d'horloge, une seconde à l'écran.
  //
  // La fenêtre était calculée une fois au montage et plus jamais : le décompte
  // restait figé sur sa valeur d'ouverture, et l'écran ne s'apercevait pas
  // davantage du passage du créneau à l'heure dite. Le battement est local —
  // les bornes viennent du serveur, pas leur écoulement.
  const [seconde, setSeconde] = useState(() => Date.now());

  useEffect(() => {
    const battement = setInterval(() => setSeconde(Date.now()), 1000);
    return () => clearInterval(battement);
  }, []);

  const debut = booking.data?.start ? new Date(booking.data.start) : null;
  const fenetreMin = checkWindow.data?.windowMin ?? 10;
  const ecoulees = debut ? Math.floor((seconde - debut.getTime()) / 1000) : null;
  const restantes =
    ecoulees === null ? null : Math.max(0, Math.min(fenetreMin * 60, fenetreMin * 60 - ecoulees));

  // Les mêmes bornes que le serveur : `[début, début + fenêtre)`. L'écran
  // annonçait une ouverture dix minutes avant le début, et chaque essai
  // repartait en 422.
  const ouverte = ecoulees !== null && ecoulees >= 0 && restantes > 0;
  const avantOuverture = ecoulees !== null && ecoulees < 0;

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

  /**
   * « Je suis en retard » : le serveur pose la présence et la salle reste
   * réservée. Ce n'est pas une prolongation de fenêtre — rien dans l'API ne
   * prolonge quoi que ce soit, et l'écran l'annonçait pourtant.
   *
   * L'appel partait sans `catch` : un refus du serveur finissait en « Uncaught
   * (in promise) » dans la console, et l'utilisateur ne voyait rien du tout.
   */
  const declarerRetard = async () => {
    setPending(true);
    setError(null);
    try {
      await declareLate(id, retardMin || null);
      toast.success(
        'Retard signalé',
        retardMin
          ? `Votre présence est validée ; ${retardMin} minutes annoncées.`
          : 'Votre présence est validée, la salle reste à vous.',
      );
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
                {/* Avant l'heure, l'anneau décompte jusqu'à l'ouverture. Il
                    affichait une fenêtre pleine et immobile, qui n'était le
                    décompte de rien — c'est ce chronomètre figé qu'on voyait
                    une heure avant son créneau. */}
                <CountdownRing
                  remainingSec={avantOuverture ? -ecoulees : (restantes ?? fenetreMin * 60)}
                  totalSec={avantOuverture ? Math.max(-ecoulees, 1) : fenetreMin * 60}
                  legende={avantOuverture ? 'avant l’ouverture' : 'restantes'}
                  etiquette={
                    avantOuverture
                      ? 'Temps restant avant l’ouverture de la validation'
                      : 'Temps restant pour valider votre présence'
                  }
                />
                <p className="mt-2 text-center text-xs text-content-muted">
                  {ouverte
                    ? 'Fenêtre de validation ouverte'
                    : avantOuverture
                      ? `La validation ouvre au début du créneau, à ${fmtTime(booking.data.start)}.`
                      : 'Fenêtre de validation dépassée.'}
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
                  {/* Fermée, la fenêtre ferme aussi le bouton. Le laisser
                      cliquable ne produisait qu'un 422 de plus et une invitation
                      à recommencer. */}
                  <Button
                    fullWidth
                    size="lg"
                    loading={pending}
                    disabled={!ouverte || digits.some((digit) => !digit)}
                    onClick={validate}
                  >
                    Valider mon arrivée
                  </Button>
                </div>

                <Callout tone="warning" icon={Clock} className="mt-4">
                  {checkWindow.data?.autoReleaseWarning ??
                    'La salle sera libérée si la présence n’est pas validée à temps.'}
                </Callout>

                {/* Rien à déclarer avant l'heure : le serveur répond « Le
                    créneau n'a pas encore commencé », et il a raison. */}
                {!avantOuverture &&
                  (retardOuvert ? (
                    <div className="mt-4 rounded-xl border border-line bg-surface-raised p-3">
                      <label
                        htmlFor="retard-min"
                        className="block text-xs text-content-muted"
                      >
                        Retard estimé, en minutes{' '}
                        <span className="text-content-faint">(facultatif)</span>
                      </label>
                      <input
                        id="retard-min"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={480}
                        value={retardMin}
                        placeholder="15"
                        onChange={(event) => setRetardMin(event.target.value)}
                        className="mt-2 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-content focus:border-accent focus:outline-none"
                      />
                      {/* Ce que la déclaration fait vraiment : la présence est
                          validée, la salle gardée. La durée n'est qu'une
                          annonce, portée au journal de la réservation. */}
                      <p className="mt-2 text-[11px] leading-relaxed text-content-faint">
                        Votre présence sera validée et la salle vous restera acquise. La
                        durée annoncée est indicative.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          fullWidth
                          loading={pending}
                          onClick={declarerRetard}
                        >
                          Signaler mon retard
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRetardOuvert(false);
                            setRetardMin('');
                          }}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRetardOuvert(true)}
                      disabled={pending}
                      className="mx-auto mt-4 block text-xs text-accent transition hover:text-accent-hover disabled:opacity-50"
                    >
                      Je suis en retard
                    </button>
                  ))}
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
