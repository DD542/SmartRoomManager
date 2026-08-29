import { Input } from '../../ui/Form';
import { Callout } from '../../ui/Card';
import { ToggleChip } from '../../ui/Badge';
import { WEEK_DAYS } from '../../../utils/dates';

/**
 * A-06 — onglet Disponibilité.
 *
 * Ces valeurs sont exactement celles que le moteur de règles applique au
 * tunnel de réservation : les incohérences sont signalées ici, avant
 * l'enregistrement, plutôt que découvertes par l'utilisateur au moment de réserver.
 */
export function AvailabilityTab({ draft, onChange }) {
  const regles = draft.rules ?? {};
  const modifier = (patch) => onChange({ rules: { ...regles, ...patch } });

  const basculerJour = (valeur) =>
    modifier({
      visitDays: regles.visitDays.includes(valeur)
        ? regles.visitDays.filter((jour) => jour !== valeur)
        : [...regles.visitDays, valeur].sort((a, b) => a - b),
    });

  const alertes = incoherences(regles);

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-xs uppercase tracking-wide text-content-muted">
          Jours d’ouverture
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((jour) => (
            <ToggleChip
              key={jour.value}
              label={jour.label}
              active={regles.visitDays?.includes(jour.value)}
              onClick={() => basculerJour(jour.value)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Input
          type="time"
          label="Ouverture"
          value={regles.openTime ?? '08:00'}
          onChange={(event) => modifier({ openTime: event.target.value })}
        />
        <Input
          type="time"
          label="Fermeture"
          value={regles.closeTime ?? '20:00'}
          onChange={(event) => modifier({ closeTime: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Input
          type="number"
          min={15}
          step={15}
          label="Durée minimale"
          hint="En minutes"
          value={regles.minDurationMin ?? 30}
          onChange={(event) => modifier({ minDurationMin: Number(event.target.value) })}
        />
        <Input
          type="number"
          min={30}
          step={15}
          label="Durée maximale"
          hint="En minutes"
          value={regles.maxDurationMin ?? 240}
          onChange={(event) => modifier({ maxDurationMin: Number(event.target.value) })}
        />
        <Input
          type="number"
          min={0}
          step={5}
          label="Battement entre réunions"
          hint="En minutes"
          value={regles.bufferMin ?? 15}
          onChange={(event) => modifier({ bufferMin: Number(event.target.value) })}
        />
      </div>

      {alertes.length > 0 && (
        <Callout tone="danger" title="Réglage incohérent">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {alertes.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

/** Contrôles de cohérence, exposés à la page pour bloquer l'enregistrement. */
export function incoherences(regles = {}) {
  const liste = [];
  if ((regles.visitDays ?? []).length === 0) {
    liste.push('Aucun jour d’ouverture : la salle serait invisible à la réservation.');
  }
  if (regles.openTime && regles.closeTime && regles.openTime >= regles.closeTime) {
    liste.push('L’heure de fermeture doit suivre l’heure d’ouverture.');
  }
  if (regles.minDurationMin > regles.maxDurationMin) {
    liste.push('La durée minimale dépasse la durée maximale : aucun créneau ne serait valide.');
  }
  const amplitude = minutes(regles.closeTime) - minutes(regles.openTime);
  if (amplitude > 0 && regles.minDurationMin > amplitude) {
    liste.push('La durée minimale dépasse l’amplitude d’ouverture de la journée.');
  }
  return liste;
}

const minutes = (heure) => {
  if (!heure) return 0;
  const [h, m] = heure.split(':').map(Number);
  return h * 60 + m;
};
