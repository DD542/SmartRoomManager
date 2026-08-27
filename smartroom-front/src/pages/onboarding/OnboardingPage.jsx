import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { listBuildings } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../utils/cn';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/States';
import { StepWorkplace } from '../../components/onboarding/StepWorkplace';
import { StepNotifications } from '../../components/onboarding/StepNotifications';
import { StepReady } from '../../components/onboarding/StepReady';

const STEPS = ['Lieu de travail', 'Notifications', 'Récapitulatif'];

/**
 * U-00 — Onboarding de première connexion.
 * Trois étapes, sortie possible à tout moment ; les préférences sont écrites
 * par src/api/auth.js puis reprises telles quelles par le profil (U-21).
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, savePreferences, completeOnboarding } = useAuth();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState(
    () =>
      user?.preferences ?? {
        preferredBuildingId: '',
        usualCapacity: '5-10',
        emailConfirmation: true,
        inAppAlerts: true,
        reminderDelayMin: 30,
      },
  );

  const { data: buildings, status, error, reload } = useAsync(listBuildings, []);

  useEffect(() => {
    document.title = 'Bienvenue — SmartRoom Manager';
  }, []);

  const update = (patch) => setPreferences((current) => ({ ...current, ...patch }));

  const finish = async ({ skipped = false } = {}) => {
    setSaving(true);
    try {
      if (!skipped) {
        await savePreferences(preferences);
        toast.success('Préférences enregistrées', 'Vos recommandations en tiennent compte dès maintenant.');
      } else {
        completeOnboarding();
      }
      navigate('/app', { replace: true });
    } catch (err) {
      toast.error('Enregistrement impossible', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (status === 'erreur') {
    return (
      <Card className="p-6">
        <ErrorState error={error} onRetry={reload} title="Impossible de charger les bâtiments" />
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <header className="flex items-center justify-between gap-4">
        <ol className="flex items-center gap-1.5" aria-label={`Étape ${step} sur ${STEPS.length}`}>
          {STEPS.map((label, index) => (
            <li key={label}>
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all',
                  index + 1 === step ? 'w-7 bg-accent' : 'w-3 bg-line-strong',
                )}
              />
              <span className="sr-only">{label}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => finish({ skipped: true })}
          className="text-xs text-content-muted transition hover:text-content"
        >
          Passer l’étape
        </button>
      </header>

      <div className="mt-6">
        {step === 1 && (
          <StepWorkplace
            buildings={buildings ?? []}
            isLoading={status === 'chargement'}
            value={preferences}
            onChange={update}
          />
        )}
        {step === 2 && <StepNotifications value={preferences} onChange={update} />}
        {step === 3 && <StepReady value={preferences} buildings={buildings ?? []} />}
      </div>

      <footer className="mt-8 flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          icon={ArrowLeft}
          disabled={step === 1}
          onClick={() => setStep((current) => Math.max(1, current - 1))}
        >
          Précédent
        </Button>

        {step < STEPS.length ? (
          <Button iconRight={ArrowRight} onClick={() => setStep((current) => current + 1)}>
            Continuer
          </Button>
        ) : (
          <Button icon={Check} loading={saving} onClick={() => finish()}>
            Commencer
          </Button>
        )}
      </footer>
    </Card>
  );
}
