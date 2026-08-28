import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/States';

/**
 * Réservation introuvable pour le compte connecté.
 *
 * Le serveur répond 404 — et non 403 — sur la réservation d'un tiers : dire
 * « interdit » confirmerait son existence à qui essaie des identifiants au
 * hasard. La règle est bonne, mais « Réservation introuvable » laissait
 * l'utilisateur sans issue, alors que la cause la plus fréquente est banale :
 * deux comptes pour la même personne, et le lien ouvert avec le mauvais.
 *
 * Nommer le compte **connecté** ne révèle rien — l'utilisateur sait déjà qui
 * il est — et transforme une impasse en action.
 */
export function BookingUnavailable({ email, onRetry }) {
  return (
    <EmptyState
      icon={KeyRound}
      title="Réservation introuvable"
      description={
        email
          ? `Aucune réservation de ce numéro pour ${email}. Si vous l’avez créée avec un autre compte, connectez-vous avec celui-ci.`
          : 'Aucune réservation de ce numéro pour le compte connecté.'
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button to="/app/reservations" variant="secondary" size="sm">
            Mes réservations
          </Button>
          {onRetry && (
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRetry}>
              Réessayer
            </Button>
          )}
        </div>
      }
    />
  );
}
