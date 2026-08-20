import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

const TONES = {
  success: { icon: CheckCircle2, ring: 'border-success/40', color: 'text-success' },
  danger: { icon: XCircle, ring: 'border-danger/40', color: 'text-danger' },
  warning: { icon: AlertTriangle, ring: 'border-warning/40', color: 'text-warning' },
  info: { icon: Info, ring: 'border-line', color: 'text-accent' },
};

/**
 * Pile de messages, montée une seule fois par le ToastProvider.
 * `aria-live="polite"` annonce les retours sans voler le focus.
 */
export function ToastViewport({ toasts = [], onDismiss }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone] ?? TONES.info;
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex animate-fade-in-up items-start gap-3 rounded-xl border bg-surface px-3.5 py-3',
              tone.ring,
            )}
          >
            <Icon size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0', tone.color)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss?.(toast.id)}
              aria-label="Fermer la notification"
              className="rounded p-0.5 text-content-faint transition hover:text-content"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
