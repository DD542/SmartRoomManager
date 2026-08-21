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
export function GeneralTab({ draft, onChange, buildings = [], errors = {} }) {
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Bâtiment"
          required
          placeholder="Choisir un bâtiment"
          options={buildings}
          value={draft.buildingId}
          onChange={(event) => onChange({ buildingId: event.target.value })}
        />
        <Input
          label="Étage"
          required
          placeholder="2e"
          value={draft.floor}
          onChange={(event) => onChange({ floor: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
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
