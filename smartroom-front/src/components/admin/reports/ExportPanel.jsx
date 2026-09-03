import { useState } from 'react';
import { Download, Table2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Form';
import { SegmentedControl } from '../../ui/Tabs';
import { fmtDate } from '../../../utils/dates';
import { plural } from '../../../utils/format';

// Un seul format, parce qu'un seul existe. « Excel » et « PDF » etaient
// proposes a cote de « CSV » et la couche de donnees les refusait a chaque
// fois : `format_indisponible`, 422, apres avoir choisi ses colonnes et
// clique sur « Generer le fichier ».
//
// C'est la regle que ce projet applique deja au bouton Google : un bouton
// present qui echoue a chaque clic est pire que pas de bouton — il fait
// croire a une panne la ou il n'y a qu'une option non ecrite.
//
// Les deux formats reviendront le jour ou ils seront implementes. Aucun des
// deux ne se produit sans une dependance nouvelle, cote serveur comme cote
// navigateur ; c'est une decision, pas un oubli.
const FORMATS = [{ value: 'csv', label: 'CSV', icon: Table2 }];

/**
 * A-02 — panneau d'export.
 *
 * Le choix des colonnes est réellement transmis à l'API : un export sans
 * colonne est refusé côté couche de données, le bouton est donc désactivé ici
 * plutôt que de laisser partir une requête vouée à l'échec.
 */
export function ExportPanel({ open, onClose, onExport, columns = [], filters, rows = 0, loading = false }) {
  const [format, setFormat] = useState('csv');
  const [choisies, setChoisies] = useState(() => columns.filter((c) => c.default).map((c) => c.id));

  const basculer = (id) =>
    setChoisies((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Download}
      tone="accent"
      title="Exporter le rapport"
      description={`${plural(rows, 'salle')} — du ${fmtDate(filters.from)} au ${fmtDate(filters.to)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            icon={Download}
            loading={loading}
            disabled={choisies.length === 0}
            onClick={() => onExport({ format, columns: choisies })}
          >
            Générer le fichier
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">Format</p>
          <SegmentedControl
            label="Format d’export"
            options={FORMATS}
            value={format}
            onChange={setFormat}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-xs uppercase tracking-wide text-content-muted">
            Colonnes incluses
          </legend>
          <div className="flex flex-col gap-2">
            {columns.map((colonne) => (
              <Checkbox
                key={colonne.id}
                label={colonne.label}
                checked={choisies.includes(colonne.id)}
                onChange={() => basculer(colonne.id)}
              />
            ))}
          </div>
          {choisies.length === 0 && (
            <p className="mt-2 text-xs text-danger">
              Sélectionnez au moins une colonne pour générer le fichier.
            </p>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
