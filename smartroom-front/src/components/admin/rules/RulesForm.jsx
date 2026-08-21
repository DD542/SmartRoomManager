import { Input } from '../../ui/Form';
import { Card, CardHeader } from '../../ui/Card';

const CHAMPS = [
  {
    id: 'minDurationMin',
    label: 'Durée minimale',
    hint: 'En minutes — au moins 15',
    min: 15,
    step: 15,
  },
  { id: 'maxDurationMin', label: 'Durée maximale', hint: 'En minutes', min: 30, step: 15 },
  {
    id: 'bufferMin',
    label: 'Battement entre réunions',
    hint: 'Minutes libres exigées entre deux réservations d’une même salle',
    min: 0,
    step: 5,
  },
  {
    id: 'weeklyQuotaHours',
    label: 'Quota hebdomadaire',
    hint: 'Heures réservables par utilisateur et par semaine',
    min: 1,
    step: 1,
  },
  {
    id: 'maxConcurrentSlots',
    label: 'Réservations simultanées',
    hint: 'Créneaux à venir détenus en même temps',
    min: 1,
    step: 1,
  },
  {
    id: 'checkInWindowMin',
    label: 'Fenêtre de validation de présence',
    hint: 'Minutes après le début pour valider — au moins 5',
    min: 5,
    step: 5,
  },
];

/**
 * A-10 — les six réglages qui pilotent le tunnel de réservation.
 *
 * Ce sont exactement les valeurs lues par le moteur de règles et par l'écran de
 * check-in : les modifier ici change le comportement réel de l'application.
 */
export function RulesForm({ draft, onChange, scopeLabel }) {
  return (
    <Card>
      <CardHeader
        title="Règles de réservation"
        subtitle={`Portée : ${scopeLabel}`}
      />
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {CHAMPS.map((champ) => (
          <Input
            key={champ.id}
            type="number"
            label={champ.label}
            hint={champ.hint}
            min={champ.min}
            step={champ.step}
            value={draft[champ.id]}
            onChange={(event) => onChange({ [champ.id]: Number(event.target.value) })}
          />
        ))}
      </div>
    </Card>
  );
}
