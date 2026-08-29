import { Input, Select, Textarea } from '../../ui/Form';

const STATUTS = [
  { value: 'disponible', label: 'Disponible' },
  { value: 'maintenance', label: 'En maintenance' },
  { value: 'archivee', label: 'Archivée' },
];

/**
 * A-06 — onglet Général.
 *
 * Capacité et surface sont numériques et bornées à 1 : ce sont elles qui
 * alimentent le moteur de recommandation, une valeur nulle le fausserait.
 */
export function GeneralTab({ draft, onChange, buildings = [], floors = [], errors = {} }) {
  // Les étages du bâtiment choisi, et eux seuls : proposer ceux des autres
  // laisserait rattacher une salle à un niveau qui n'existe pas chez elle.
  const etagesDuBatiment = floors
    .filter((etage) => etage.buildingId === draft.buildingId)
    // Le bâtiment est déjà choisi juste à côté : le répéter sur chaque option
    // n'apprend rien. Les étages restent triés par niveau, « RDC » précédant
    // « 1er », ce qu'un tri alphabétique ne ferait pas.
    .map((etage) => ({ ...etage, label: etage.shortLabel ?? etage.label }))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Nom de la salle"
        required
        placeholder="Salle Vinci"
        value={draft.name}
        error={errors.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Select
          label="Bâtiment"
          required
          placeholder="Choisir un bâtiment"
          options={buildings}
          value={draft.buildingId}
          error={errors.buildingId}
          // Changer de bâtiment vide l'étage : le garder rattacherait la salle
          // à un niveau d'un autre bâtiment, que l'API refuserait sans que
          // l'écran dise pourquoi.
          onChange={(event) => onChange({ buildingId: event.target.value, floorId: '' })}
        />
        {/* Une liste et non un champ libre. C'était un texte, et l'API attend
            un identifiant d'étage : aucune saisie ne pouvait aboutir, la
            création échouant toujours sur « L'étage est obligatoire ». */}
        <Select
          label="Étage"
          required
          placeholder={
            draft.buildingId ? 'Choisir un étage' : 'Choisissez d’abord un bâtiment'
          }
          disabled={!draft.buildingId}
          options={etagesDuBatiment}
          value={draft.floorId}
          error={errors.floorId}
          hint={
            draft.buildingId && etagesDuBatiment.length === 0
              ? 'Ce bâtiment n’a pas encore d’étage : ajoutez-en un depuis Bâtiments.'
              : undefined
          }
          onChange={(event) => onChange({ floorId: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Input
          type="number"
          min={1}
          label="Capacité"
          hint="Nombre de places assises"
          required
          value={draft.capacity}
          error={errors.capacity}
          onChange={(event) => onChange({ capacity: event.target.value })}
        />
        <Input
          type="number"
          min={1}
          label="Surface"
          hint="En m²"
          required
          value={draft.area}
          error={errors.area}
          onChange={(event) => onChange({ area: event.target.value })}
        />
        <Select
          label="Statut"
          options={STATUTS}
          value={draft.status}
          onChange={(event) => onChange({ status: event.target.value })}
        />
      </div>

      <Textarea
        label="Description"
        rows={3}
        hint="Visible par les utilisateurs sur la fiche de la salle."
        placeholder="Salle de réunion lumineuse, orientée sud…"
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </div>
  );
}
