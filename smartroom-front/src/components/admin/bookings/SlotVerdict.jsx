import { AlertTriangle } from 'lucide-react';
import { Callout } from '../../ui/Card';

/** Retour du moteur de conflits, affiché pendant la saisie. */
export function SlotVerdict({ verdict, verification, ignore }) {
  if (verification) {
    return <p className="text-xs text-content-muted">Vérification du créneau…</p>;
  }
  if (!verdict) return null;

  const regles = verdict.ruleErrors ?? [];
  const alertes = [
    ...verdict.conflicts.map((conflict) => conflict.message),
    ...regles.map((erreur) => erreur.message),
    verdict.capacityError,
  ].filter(Boolean);

  if (alertes.length === 0) {
    return (
      <Callout tone="success" title="Créneau libre">
        Aucun chevauchement, aucune règle enfreinte.
      </Callout>
    );
  }

  return (
    <Callout
      tone={verdict.blocking ? 'danger' : 'warning'}
      icon={AlertTriangle}
      title={verdict.blocking ? 'Créneau indisponible' : 'Points à confirmer'}
    >
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {alertes.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        {verdict.blocking
          ? 'Un chevauchement ne peut pas être forcé : changez de salle ou de créneau.'
          : ignore
            ? 'Ces points seront forcés : la réservation portera la mention « créée en forçant les règles ».'
            : 'Cochez « ignorer les règles » pour créer malgré ces points.'}
      </p>
    </Callout>
  );
}
