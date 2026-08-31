import { Input, Textarea } from '../../ui/Form';
import { Card, CardHeader } from '../../ui/Card';

/**
 * Les dix réglages qui pilotent le tunnel de réservation.
 *
 * Deux défauts se voyaient à l'écran sans qu'aucune erreur ne le signale.
 *
 * D'abord, deux champs restaient **vides en permanence** : le formulaire liait
 * `maxConcurrentSlots` et `checkInWindowMin`, quand l'adaptateur produit
 * `maxActiveBookings` et `checkinWindowMin`. Ils n'affichaient donc jamais la
 * valeur en vigueur, et les enregistrer envoyait `undefined`.
 *
 * Ensuite, quatre règles étaient **appliquées sans être réglables** : horizon
 * de réservation, préavis minimal, délai d'annulation et seuil de validation.
 * Le moteur les fait respecter, l'écran de réservation les récite à
 * l'utilisateur — « Réservable jusqu'à 60 jours à l'avance » —, l'API les
 * accepte, et aucune interface ne permettait de les changer. Elles sont ici.
 *
 * L'ordre suit la vie d'une réservation : combien de temps, quand, combien,
 * et ce qui se passe après.
 */
const GROUPES = [
  {
    id: 'duree',
    label: 'Durée d’un créneau',
    champs: [
      {
        id: 'minDurationMin',
        label: 'Durée minimale',
        hint: 'En minutes — au moins 15',
        min: 15,
        max: 1440,
        step: 15,
      },
      {
        id: 'maxDurationMin',
        label: 'Durée maximale',
        hint: 'En minutes',
        min: 30,
        max: 1440,
        step: 15,
      },
      {
        id: 'bufferMin',
        label: 'Battement entre réunions',
        hint: 'Minutes libres exigées entre deux réservations d’une même salle',
        min: 0,
        max: 120,
        step: 5,
      },
    ],
  },
  {
    id: 'delais',
    label: 'Délais',
    champs: [
      {
        id: 'maxAdvanceDays',
        label: 'Horizon de réservation',
        hint: 'Jours à l’avance au plus — au-delà, la date est refusée',
        min: 1,
        max: 365,
        step: 1,
      },
      {
        id: 'minAdvanceMin',
        label: 'Préavis minimal',
        hint: 'Minutes avant le début — empêche de réserver « pour tout de suite »',
        min: 0,
        max: 1440,
        step: 5,
      },
      {
        id: 'cancelDeadlineMin',
        label: 'Délai d’annulation',
        hint: 'Minutes avant le début jusqu’auxquelles l’annulation reste possible',
        min: 0,
        max: 10080,
        step: 15,
      },
    ],
  },
  {
    id: 'quotas',
    label: 'Quotas par utilisateur',
    champs: [
      {
        id: 'weeklyQuotaHours',
        label: 'Quota hebdomadaire',
        hint: 'Heures réservables par utilisateur et par semaine',
        min: 1,
        max: 168,
        step: 1,
      },
      {
        id: 'maxActiveBookings',
        label: 'Réservations simultanées',
        hint: 'Créneaux à venir détenus en même temps',
        min: 1,
        max: 100,
        step: 1,
      },
    ],
  },
  {
    id: 'apres',
    label: 'Après la réservation',
    champs: [
      {
        id: 'checkinWindowMin',
        label: 'Fenêtre de validation de présence',
        hint: 'Minutes après le début pour valider — au moins 5',
        min: 5,
        max: 120,
        step: 5,
      },
      {
        id: 'validationThreshold',
        label: 'Seuil de validation administrative',
        hint: 'Capacité au-delà de laquelle la réservation passe en validation — vide pour aucune',
        min: 1,
        max: 500,
        step: 1,
        facultatif: true,
      },
    ],
  },
];

/** Tous les champs à plat : sert au calcul d'impact et aux tests. */
export const CHAMPS_REGLES = GROUPES.flatMap((groupe) => groupe.champs);

export function RulesForm({ draft, onChange, scopeLabel }) {
  return (
    <Card>
      <CardHeader title="Règles de réservation" subtitle={`Portée : ${scopeLabel}`} />

      <div className="flex flex-col gap-5 p-4">
        {GROUPES.map((groupe) => (
          <fieldset key={groupe.id}>
            <legend className="pb-2 text-[11px] uppercase tracking-wide text-content-faint">
              {groupe.label}
            </legend>

            {/* Une colonne au téléphone, deux dès 640 px : dix champs sur deux
                colonnes étroites donnaient des libellés coupés en trois lignes. */}
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              {groupe.champs.map((champ) => (
                <Input
                  key={champ.id}
                  type="number"
                  label={champ.label}
                  hint={champ.hint}
                  min={champ.min}
                  max={champ.max}
                  step={champ.step}
                  // `?? ''` : l'API rend `null` pour un seuil non défini, et
                  // React refuse `null` sur un champ contrôlé — l'avertissement
                  // se répétait à chaque frappe.
                  value={draft[champ.id] ?? ''}
                  onChange={(event) => {
                    const brut = event.target.value;
                    onChange({
                      // Un champ facultatif vidé vaut « aucune règle », pas
                      // zéro : envoyer 0 imposerait une validation sur toutes
                      // les salles.
                      [champ.id]:
                        brut === '' ? (champ.facultatif ? null : '') : Number(brut),
                    });
                  }}
                />
              ))}
            </div>
          </fieldset>
        ))}

        {/* Hors des groupes ci-dessus, et volontairement : les dix réglages
            sont des nombres que l'écran de réservation sait reformuler tout
            seul — « Réservable jusqu'à 60 jours à l'avance ». Une consigne ne
            se déduit d'aucun seuil. C'est la seule chose du sujet que
            l'administration doit pouvoir écrire, et elle n'avait jusqu'ici que
            le nom de la salle pour la faire passer. */}
        <fieldset>
          <legend className="pb-2 text-[11px] uppercase tracking-wide text-content-faint">
            Consigne aux utilisateurs
          </legend>
          <Textarea
            label="Message affiché au moment de réserver"
            hint={`Facultatif, 500 caractères au plus. Affiché tel quel dans le tunnel — portée : ${scopeLabel}.`}
            rows={3}
            maxLength={500}
            placeholder="Laissez la salle rangée. La clé se retire à l’accueil."
            value={draft.notice ?? ''}
            onChange={(event) => onChange({ notice: event.target.value })}
          />
        </fieldset>
      </div>
    </Card>
  );
}
