import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { equipmentIcon } from '../../rooms/equipmentIcons';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../ui/Form';

const VIERGE = { label: '', category: 'av', icon: 'Monitor', description: '', filterable: false };

/**
 * A-07 — création et modification d'un équipement.
 *
 * L'icône se choisit dans la table réellement embarquée par l'application :
 * saisir un nom libre produirait une icône manquante côté utilisateur.
 */
export function EquipmentModal({ open, onClose, onSubmit, equipment, icons = [], categories = [], loading = false }) {
  const [form, setForm] = useState(VIERGE);

  useEffect(() => {
    if (open) setForm(equipment ? { ...VIERGE, ...equipment } : VIERGE);
  }, [open, equipment]);

  const modifier = (patch) => setForm((current) => ({ ...current, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Wrench}
      tone="accent"
      title={equipment ? 'Modifier l’équipement' : 'Nouvel équipement'}
      description="Le catalogue alimente les fiches de salle et les filtres de recherche."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={!form.label.trim()} onClick={() => onSubmit(form)}>
            {equipment ? 'Enregistrer' : 'Créer l’équipement'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nom"
          required
          placeholder="Écran 4K"
          value={form.label}
          onChange={(event) => modifier({ label: event.target.value })}
        />

        <Select
          label="Catégorie"
          options={categories.map((item) => ({ value: item.id, label: item.label }))}
          value={form.category}
          onChange={(event) => modifier({ category: event.target.value })}
        />

        <Field label="Icône">
          <ul className="flex flex-wrap gap-2">
            {icons.map((nom) => {
              const Icone = equipmentIcon(nom);
              const actif = form.icon === nom;
              return (
                <li key={nom}>
                  <button
                    type="button"
                    onClick={() => modifier({ icon: nom })}
                    aria-pressed={actif}
                    aria-label={`Icône ${nom}`}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-xl border transition',
                      actif
                        ? 'border-accent bg-accent-soft text-accent-bright'
                        : 'border-line bg-surface-raised text-content-muted hover:border-line-strong',
                    )}
                  >
                    <Icone size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Field>

        <Textarea
          label="Descriptif"
          rows={2}
          hint="Affiché en infobulle sur la fiche de la salle."
          value={form.description}
          onChange={(event) => modifier({ description: event.target.value })}
        />

        <Checkbox
          label="Proposer comme filtre de recherche"
          description="L’équipement apparaît dans les filtres de l’espace utilisateur."
          checked={form.filterable}
          onChange={() => modifier({ filterable: !form.filterable })}
        />
      </div>
    </Modal>
  );
}
