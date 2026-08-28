import { KeyRound, Lock, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

/**
 * Code d'accès physique, en monospace et jamais tronqué.
 *
 * Il n'y a plus de bascule « Révéler / Masquer ». Elle promettait ce que
 * personne ne détient : le clair n'existe qu'à l'émission, la base n'en garde
 * qu'une empreinte et un indice — `E-****`. Les deux écrans qui l'affichaient
 * masquaient donc un indice déjà masqué, et « Révéler » rendait le même
 * `E-****`. Un bouton qui ne fait rien est pire qu'un bouton absent : on
 * l'essaie, puis on doute du reste.
 *
 * Perdre son code se répare en en émettant un neuf, depuis la réservation.
 */
export function AccessCode({ code, size = 'lg', className }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2">
        <KeyRound size={14} aria-hidden="true" className="text-content-muted" />
        <span
          className={cn(
            'font-mono tracking-[0.2em] text-content',
            size === 'lg' ? 'text-2xl' : 'text-sm',
          )}
        >
          {code ?? '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * Encart complet « Code d'accès » du détail de réservation.
 *
 * `code` est le code en clair, et il n'existe qu'au moment de son émission :
 * la base n'en garde qu'une empreinte et un indice masqué. Passé cet instant,
 * l'écran ne dispose plus que de l'indice — `A-****` — et proposer de le
 * « révéler » promettait ce que personne ne détient plus.
 *
 * Trois états, et non deux : le code en clair, l'indice d'un code encore
 * valable, et l'absence de tout code actif. Le troisième est le plus courant —
 * code révoqué, réservation créée avant que la salle ne passe sous badge — et
 * c'est celui qui doit proposer une émission plutôt qu'un encart vide.
 */
export function AccessCodePanel({
  code,
  hint,
  badgeRequired = false,
  canReissue = false,
  onReissue,
  reissuing = false,
  children,
  className,
}) {
  const enClair = Boolean(code);
  const affichable = enClair ? code : hint;

  return (
    <div className={cn('flex flex-col items-center gap-3 p-4 text-center', className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-raised">
        <Lock size={16} aria-hidden="true" className="text-content-muted" />
      </span>
      <div>
        <p className="text-sm font-semibold text-content">Code d’accès</p>
        <p className="mt-0.5 text-xs text-content-muted">
          {enClair
            ? 'Notez-le : il n’est affiché qu’une fois.'
            : affichable
              ? 'Utilisez ce code sur le terminal de la salle'
              : 'Aucun code actif pour cette réservation'}
        </p>
      </div>

      {affichable && <AccessCode code={affichable} />}

      {!enClair && (
        <p className="text-xs text-content-muted">
          {affichable
            ? 'Le code complet n’est affiché qu’une fois, à son émission. Il n’est pas conservé en clair — seul son début l’est.'
            : 'Cette salle demande un code à sa porte. Émettez-en un avant de vous présenter.'}
        </p>
      )}

      {!enClair && canReissue && onReissue && (
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={reissuing}
          onClick={onReissue}
        >
          {affichable ? 'Émettre un nouveau code' : 'Émettre un code'}
        </Button>
      )}

      {badgeRequired && (
        <p className="w-full rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs font-medium uppercase tracking-wide text-warning">
          Badge requis
        </p>
      )}
      {children}
    </div>
  );
}
