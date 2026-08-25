import { useState } from 'react';
import { CheckCheck, EyeOff, Send } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox, Textarea } from '../../ui/Form';
import { Card, CardHeader } from '../../ui/Card';
import { fmtDate, fmtTime } from '../../../utils/dates';
import { TICKET_STATUS_LABEL } from '../../../utils/format';

/**
 * A-13 — fil de discussion et zone de réponse.
 *
 * Une note interne reste dans le fil mais n'est jamais envoyée au demandeur :
 * elle est signalée visuellement pour qu'aucune confusion ne soit possible.
 */
export function TicketThread({ ticket, templates = [], onReply, busy = false }) {
  const [texte, setTexte] = useState('');
  const [interne, setInterne] = useState(false);
  const [resoudre, setResoudre] = useState(false);

  const envoyer = async () => {
    const ok = await onReply({ body: texte, internal: interne, resolve: resoudre });
    if (ok) {
      setTexte('');
      setInterne(false);
      setResoudre(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={ticket.subject}
        subtitle={`${ticket.reference ?? `#${ticket.id}`} · ${ticket.assignee ?? 'non attribué'}`}
        action={
          <Badge tone={ticket.status === 'resolu' ? 'success' : 'warning'} dot>
            {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
          </Badge>
        }
      />

      <ol className="flex flex-col gap-3 px-4 pb-4">
        {ticket.messages.map((message, index) => {
          const support = message.author === 'support';
          return (
            <li
              key={`${message.at}-${index}`}
              className={cn('flex gap-2.5', support && 'flex-row-reverse')}
            >
              <Avatar
                name={support ? 'Support' : (ticket.requester?.name ?? 'Utilisateur')}
                size="sm"
              />
              <div
                className={cn(
                  'max-w-[38rem] rounded-xl border px-3 py-2.5',
                  message.internal
                    ? 'border-warning/40 bg-warning-soft'
                    : support
                      ? 'border-accent/40 bg-accent-soft'
                      : 'border-line bg-surface-raised',
                )}
              >
                {message.internal && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-warning">
                    <EyeOff size={11} aria-hidden="true" />
                    Note interne — non visible du demandeur
                  </p>
                )}
                <p className="whitespace-pre-line text-sm text-content">{message.body}</p>
                <p className="mt-1 font-mono text-[10px] text-content-faint">
                  {fmtDate(message.at)} à {fmtTime(message.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line p-4">
        {templates.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs uppercase tracking-wide text-content-muted">
              Réponses types
            </p>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((modele) => (
                <Button
                  key={modele.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => setTexte(modele.body)}
                >
                  {modele.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <Textarea
          label="Réponse"
          rows={4}
          placeholder="Écrivez votre réponse, ou insérez une réponse type ci-dessus."
          value={texte}
          onChange={(event) => setTexte(event.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Checkbox
            label="Note interne"
            checked={interne}
            onChange={() => setInterne((current) => !current)}
          />
          <Checkbox
            label="Marquer le ticket comme résolu"
            checked={resoudre}
            onChange={() => setResoudre((current) => !current)}
          />
          <Button
            className="ml-auto"
            icon={resoudre ? CheckCheck : Send}
            loading={busy}
            disabled={!texte.trim()}
            onClick={envoyer}
          >
            {interne ? 'Ajouter la note' : 'Envoyer la réponse'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
