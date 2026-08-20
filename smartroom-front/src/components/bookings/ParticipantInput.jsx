import { useState } from 'react';
import { Mail, Plus, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Saisie d'invités : validation d'adresse, doublons refusés, retrait au clavier. */
export function ParticipantInput({ participants = [], onChange, label = 'Inviter des participants' }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  const add = () => {
    const email = value.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_PATTERN.test(email)) {
      setError('Adresse e-mail invalide.');
      return;
    }
    if (participants.some((participant) => participant.email === email)) {
      setError('Ce participant est déjà invité.');
      return;
    }
    onChange([
      ...participants,
      { email, name: email.split('@')[0].replace('.', ' '), status: 'en_attente', organizer: false },
    ]);
    setValue('');
    setError(null);
  };

  return (
    <Field label={label} htmlFor="invite" error={error}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Mail
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
          />
          <input
            id="invite"
            type="email"
            value={value}
            placeholder="Saisissez une adresse e-mail…"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            className="h-10 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
          />
        </div>
        <Button variant="secondary" icon={Plus} onClick={add}>
          Ajouter
        </Button>
      </div>

      {participants.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {participants.map((participant) => (
            <li
              key={participant.email}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised py-1 pl-2 pr-1 text-xs text-content"
            >
              {participant.email}
              <button
                type="button"
                onClick={() => onChange(participants.filter((p) => p.email !== participant.email))}
                aria-label={`Retirer ${participant.email}`}
                className="rounded p-0.5 text-content-faint transition hover:text-danger"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}
