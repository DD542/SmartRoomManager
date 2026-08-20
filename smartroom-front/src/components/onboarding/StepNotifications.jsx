import { Bell, Mail } from 'lucide-react';
import { SegmentedControl } from '../ui/Tabs';
import { Switch } from '../ui/Form';

const DELAYS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
];

/** U-00, étape 2 — préférences de notification, reprises telles quelles en U-21. */
export function StepNotifications({ value, onChange }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-content">Comment souhaitez-vous être prévenu ?</h2>
      <p className="mt-1 text-sm text-content-muted">
        Ces réglages restent modifiables à tout moment depuis votre profil.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <Switch
          icon={Mail}
          label="Confirmation par e-mail"
          description="Un récapitulatif avec le code d’accès à chaque réservation."
          checked={value.emailConfirmation}
          onChange={(checked) => onChange({ emailConfirmation: checked })}
        />
        <div className="h-px bg-line" aria-hidden="true" />
        <Switch
          icon={Bell}
          label="Alertes dans l’application"
          description="Conflits, validations et réponses du support."
          checked={value.inAppAlerts}
          onChange={(checked) => onChange({ inAppAlerts: checked })}
        />
        <div className="h-px bg-line" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-content">Délai de rappel</p>
            <p className="text-xs text-content-muted">Avant le début de la réunion.</p>
          </div>
          <SegmentedControl
            label="Délai de rappel"
            options={DELAYS}
            value={value.reminderDelayMin}
            onChange={(delay) => onChange({ reminderDelayMin: delay })}
          />
        </div>
      </div>
    </div>
  );
}
