import { useState } from 'react';
import { ArrowRightLeft, Ban, Gavel, ShieldCheck } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Form';
import { AlternativeList } from './AlternativeList';

/**
 * Les trois décisions de l'API sont les mêmes partout, seuls les libellés
 * changent : « maintenir » n'a pas de sens devant une demande d'accès, où la
 * même valeur signifie « accorder ».
 */
const DECISIONS = {
  conflit: [
    {
      value: 'maintien',
      label: 'Maintenir la réservation initiale',
      description: 'Le second demandeur est débouté et prévenu.',
      icon: ShieldCheck,
    },
    {
      value: 'alternative',
      label: 'Proposer une salle de repli',
      description: 'Le second demandeur est réorienté vers la salle choisie.',
      icon: ArrowRightLeft,
    },
    {
      value: 'refus',
      label: 'Refuser la demande',
      description: 'La demande contestée est annulée, sans report.',
      icon: Ban,
    },
  ],
  demande: [
    {
      value: 'maintien',
      label: 'Accorder la demande',
      description: 'L’accès est autorisé à titre exceptionnel, et journalisé.',
      icon: ShieldCheck,
    },
    {
      value: 'alternative',
      label: 'Orienter vers une autre salle',
      description: 'La demande est satisfaite dans une salle déjà ouverte.',
      icon: ArrowRightLeft,
    },
    {
      value: 'refus',
      label: 'Refuser la demande',
      description: 'Le demandeur est prévenu du motif du refus.',
      icon: Ban,
    },
  ],
};

/**
 * A-04 — décision de l'administrateur.
 *
 * « Proposer une salle de repli » exige de choisir la salle : l'API refuse la
 * décision sans alternative, le formulaire ne laisse donc pas l'envoyer.
 */
export function ArbitrationPanel({ alternatives = [], variant = 'conflit', onSubmit, loading = false }) {
  const [decision, setDecision] = useState('maintien');
  const [salle, setSalle] = useState(null);
  const [commentaire, setCommentaire] = useState('');

  const incomplet = decision === 'alternative' && !salle;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs uppercase tracking-wide text-content-muted">Décision</legend>
        {(DECISIONS[variant] ?? DECISIONS.conflit).map((option) => {
          const actif = decision === option.value;
          const Icone = option.icon;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                actif ? 'border-accent bg-accent-soft' : 'border-line bg-surface-raised hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name="decision-arbitrage"
                value={option.value}
                checked={actif}
                onChange={() => setDecision(option.value)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm text-content">
                  <Icone size={14} aria-hidden="true" className="text-content-muted" />
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-content-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {decision === 'alternative' && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
            {variant === 'conflit' ? 'Salle proposée au demandeur débouté' : 'Salle proposée au demandeur'}
          </p>
          <AlternativeList alternatives={alternatives} selectedId={salle} onSelect={setSalle} />
        </div>
      )}

      <Textarea
        label="Commentaire transmis aux demandeurs"
        rows={3}
        placeholder="Antériorité de la demande, effectif, contrainte pédagogique…"
        hint="Facultatif, mais il constitue la trace de la décision au journal d’audit."
        value={commentaire}
        onChange={(event) => setCommentaire(event.target.value)}
      />

      <Button
        icon={Gavel}
        loading={loading}
        disabled={incomplet}
        onClick={() => onSubmit({ decision, comment: commentaire, alternativeRoomId: salle })}
      >
        Rendre la décision
      </Button>
    </div>
  );
}
