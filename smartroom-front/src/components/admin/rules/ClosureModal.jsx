import { useEffect, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Form';
import { ToggleChip } from '../../ui/Badge';
import { NOW, toDateInput } from '../../../utils/dates';

const PORTEES = [
  { value: 'global', label: 'Tout l’établissement' },
  { value: 'batiment', label: 'Certains bâtiments' },
  { value: 'salles', label: 'Certaines salles' },
];

const NATURES = [
  { value: 'ferme', label: 'Fermeture — aucune réservation possible' },
  { value: 'exception', label: 'Exception — ouverture ou usage particulier' },
];

const VIERGE = {
  label: '',
  from: toDateInput(NOW),
  to: toDateInput(NOW),
  scopeType: 'global',
  scopeIds: [],
  kind: 'ferme',
};

/**
 * A-09 — déclaration d'une fermeture exceptionnelle.
 *
 * La portée conditionne la suite : « tout l'établissement » n'attend aucune
 * sélection, les deux autres en exigent une, comme le contrôle de l'API.
 */
export function ClosureModal({ open, onClose, onSubmit, buildings = [], rooms = [], loading = false }) {
  const [form, setForm] = useState(VIERGE);

  useEffect(() => {
    if (open) setForm(VIERGE);
  }, [open]);

  const modifier = (patch) => setForm((current) => ({ ...current, ...patch }));
  const cibles = form.scopeType === 'batiment' ? buildings : rooms;

  const basculer = (id) =>
    modifier({
      scopeIds: form.scopeIds.includes(id)
        ? form.scopeIds.filter((item) => item !== id)
        : [...form.scopeIds, id],
    });

  const incomplet =
    !form.label.trim() ||
    form.to < form.from ||
    (form.scopeType !== 'global' && form.scopeIds.length === 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={CalendarOff}
      tone="warning"
      title="Nouvelle fermeture"
      description="La période devient indisponible à la réservation pour la portée choisie."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={incomplet} onClick={() => onSubmit(form)}>
            Déclarer la fermeture
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Motif"
          required
          placeholder="Vacances de printemps, jour férié, travaux…"
          value={form.label}
          onChange={(event) => modifier({ label: event.target.value })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label="Du"
            required
            value={form.from}
            onChange={(event) => modifier({ from: event.target.value })}
          />
          <Input
            type="date"
            label="Au"
            required
            min={form.from}
            error={form.to < form.from ? 'La fin précède le début.' : undefined}
            value={form.to}
            onChange={(event) => modifier({ to: event.target.value })}
          />
        </div>

        <Select
          label="Nature"
          options={NATURES}
          value={form.kind}
          onChange={(event) => modifier({ kind: event.target.value })}
        />

        <Select
          label="Portée"
          options={PORTEES}
          value={form.scopeType}
          onChange={(event) => modifier({ scopeType: event.target.value, scopeIds: [] })}
        />

        {form.scopeType !== 'global' && (
          <fieldset>
            <legend className="mb-2 text-xs uppercase tracking-wide text-content-muted">
              {form.scopeType === 'batiment' ? 'Bâtiments concernés' : 'Salles concernées'}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {cibles.map((cible) => (
                <ToggleChip
                  key={cible.value}
                  label={cible.label}
                  active={form.scopeIds.includes(cible.value)}
                  onClick={() => basculer(cible.value)}
                />
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
