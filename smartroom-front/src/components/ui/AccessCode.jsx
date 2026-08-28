import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { maskAccessCode } from '../../utils/format';
import { Button } from './Button';

/**
 * Code d'accès physique. Toujours en monospace, jamais tronqué, et masquable
 * sur les écrans où il reste visible longtemps (dashboard).
 *
 * L'affichage est une bascule : on révèle le code le temps de le lire, puis on
 * le remasque, par exemple avant de partager son écran.
 */
export function AccessCode({ code, masked = false, size = 'lg', className }) {
  const [revealed, setRevealed] = useState(!masked);
  const display = revealed ? (code ?? '—') : maskAccessCode(code);

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
          {display}
        </span>
        <span className="sr-only">
          {revealed ? 'Code d’accès affiché' : 'Code d’accès masqué'}
        </span>
      </div>
      {masked && (
        <Button
          variant="ghost"
          size="sm"
          icon={revealed ? EyeOff : Eye}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? 'Masquer' : 'Révéler'}
        </Button>
      )}
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
