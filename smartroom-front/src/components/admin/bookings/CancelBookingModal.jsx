import { useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox, Select, Textarea } from '../../ui/Form';
import { Callout } from '../../ui/Card';
import { plural } from '../../../utils/format';

const MOTIFS = [
  { value: 'Salle indisponible', label: 'Salle indisponible' },
  { value: 'Travaux ou maintenance', label: 'Travaux ou maintenance' },
  { value: 'Arbitrage de conflit', label: 'Arbitrage de conflit' },
  { value: 'Demande de l’organisateur', label: 'Demande de l’organisateur' },
  { value: 'Non-respect des règles', label: 'Non-respect des règles' },
  { value: 'Autre motif', label: 'Autre motif' },
];

/**
 * A-03 — annulation, à l'unité ou en lot.
 *
 * Le motif est obligatoire : il part dans l'e-mail à l'organisateur et reste
 * dans l'historique de la réservation, où il constitue la seule trace de la
 * décision.
 */
export function CancelBookingModal({ open, onClose, onConfirm, count = 1, loading = false }) {
  const [motif, setMotif] = useState('');
  const [precision, setPrecision] = useState('');
  const [prevenir, setPrevenir] = useState(true);

  const complet = motif === 'Autre motif' ? precision.trim().length > 2 : Boolean(motif);
  const libelle = motif === 'Autre motif' ? precision.trim() : motif;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={CalendarX2}
      tone="danger"
      title={count > 1 ? `Annuler ${plural(count, 'réservation')}` : 'Annuler la réservation'}
      description="L’organisateur est prévenu du motif retenu."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Revenir
          </Button>
          <Button
            variant="danger-solid"
            loading={loading}
            disabled={!complet}
            onClick={() => onConfirm({ reason: libelle, notifyOwner: prevenir })}
          >
            Confirmer l’annulation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Motif"
          required
          placeholder="Choisir un motif"
          options={MOTIFS}
          value={motif}
          onChange={(event) => setMotif(event.target.value)}
        />

        {motif === 'Autre motif' && (
          <Textarea
            label="Précisez le motif"
            required
            rows={3}
            value={precision}
            onChange={(event) => setPrecision(event.target.value)}
          />
        )}

        <Checkbox
          label="Prévenir l’organisateur par e-mail"
          description="Décochez uniquement si l’annulation a déjà été annoncée autrement."
          checked={prevenir}
          onChange={() => setPrevenir((current) => !current)}
        />

        {count > 1 && (
          <Callout tone="warning">
            Les réservations déjà annulées ou déjà passées seront ignorées : le compte rendu
            précisera ce qui a réellement été traité.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
