import { LifeBuoy, Plus } from 'lucide-react';
import { fmtRelative } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Form';
import { Modal } from '../ui/Modal';

/** U-22 — fil de discussion d'un ticket existant. */
export function TicketThreadModal({ ticket, onClose }) {
  return (
    <Modal
      open={Boolean(ticket)}
      onClose={onClose}
      title={ticket?.subject ?? ''}
      description={ticket ? `Ticket #${ticket.id}` : ''}
      icon={LifeBuoy}
    >
      <ol className="flex flex-col gap-3">
        {(ticket?.messages ?? []).map((message) => (
          <li
            key={message.at}
            className={`rounded-xl border px-3 py-2.5 ${
              message.author === 'support'
                ? 'border-accent/40 bg-accent-soft'
                : 'border-line bg-surface-raised'
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-content-muted">
              {message.author === 'support' ? 'Support' : 'Vous'} • {fmtRelative(message.at)}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-content">{message.body}</p>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** U-22 — création d'une demande d'assistance. */
export function NewTicketModal({ draft, categories = [], onChange, onClose, onSubmit }) {
  return (
    <Modal
      open={Boolean(draft)}
      onClose={onClose}
      title="Nouvelle demande d’aide"
      icon={Plus}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={onSubmit}>Envoyer la demande</Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-4">
          <Input
            label="Sujet"
            required
            value={draft.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
          />
          <Select
            label="Catégorie"
            value={draft.category}
            onChange={(event) => onChange({ category: event.target.value })}
            options={categories.map((item) => ({ value: item.id, label: item.label }))}
          />
          <Textarea
            label="Message"
            required
            rows={4}
            placeholder="Décrivez le problème rencontré…"
            value={draft.body}
            onChange={(event) => onChange({ body: event.target.value })}
          />
        </div>
      )}
    </Modal>
  );
}
