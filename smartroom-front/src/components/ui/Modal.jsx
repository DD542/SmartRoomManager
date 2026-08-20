import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { IconButton } from './Button';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Modale accessible : rôle dialog, focus piégé, Échap et clic sur le voile
 * ferment, le focus revient sur l'élément déclencheur.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  tone = 'default',
  size = 'md',
  children,
  footer,
}) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;

  const iconTone = {
    default: 'text-content-muted',
    accent: 'text-accent',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  }[tone];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/80"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative w-full animate-scale-in rounded-t-2xl border border-line bg-surface sm:rounded-xl',
          SIZES[size] ?? SIZES.md,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex items-start gap-2.5">
            {Icon && <Icon size={18} aria-hidden="true" className={cn('mt-0.5', iconTone)} />}
            <div>
              <h2 className="text-sm font-semibold text-content">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-content-muted">{description}</p>}
            </div>
          </div>
          <IconButton icon={X} label="Fermer" onClick={onClose} />
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Variante mobile des panneaux de filtres : feuille ancrée en bas de l'écran.
 * Même contrat d'accessibilité que Modal.
 */
export function BottomSheet({ open, onClose, title, children, footer }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-ink/80" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[85vh] w-full animate-slide-up overflow-y-auto rounded-t-2xl border-t border-line bg-surface"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} />
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && <footer className="sticky bottom-0 border-t border-line bg-surface px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
