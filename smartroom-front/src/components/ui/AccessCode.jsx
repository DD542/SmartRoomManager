import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
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
 * Vignette QR déterministe dérivée du code : rendu local, sans bibliothèque.
 * Elle sert de repère visuel à l'écran, le back fournira un vrai QR encodé.
 */
export function QrTile({ code = '', size = 96, className }) {
  const cells = 11;
  const seed = [...String(code)].reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);
  const filled = (x, y) => {
    const value = Math.abs(Math.sin(seed * (x + 1) * (y + 2))) * 10000;
    return Math.floor(value) % 3 !== 0;
  };
  const isFinder = (x, y) =>
    (x < 3 && y < 3) || (x > cells - 4 && y < 3) || (x < 3 && y > cells - 4);

  return (
    <div
      className={cn('rounded-lg bg-white p-2', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code du code d'accès ${code}`}
    >
      <svg viewBox={`0 0 ${cells} ${cells}`} className="h-full w-full" aria-hidden="true">
        {Array.from({ length: cells }).map((_, y) =>
          Array.from({ length: cells }).map((__, x) =>
            isFinder(x, y) || filled(x, y) ? (
              <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#101623" />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

/** Encart complet « Code d'accès » du détail de réservation. */
export function AccessCodePanel({ code, badgeRequired = false, children, className }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 p-4 text-center', className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-raised">
        <Lock size={16} aria-hidden="true" className="text-content-muted" />
      </span>
      <div>
        <p className="text-sm font-semibold text-content">Code d’accès</p>
        <p className="mt-0.5 text-xs text-content-muted">Utilisez ce code sur le terminal de la salle</p>
      </div>
      <AccessCode code={code} />
      <QrTile code={code} />
      {badgeRequired && (
        <p className="w-full rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs font-medium uppercase tracking-wide text-warning">
          Badge requis
        </p>
      )}
      {children}
    </div>
  );
}
