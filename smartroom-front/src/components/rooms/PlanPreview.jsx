import { useState } from 'react';
import { FileText, ImageOff, Map, Maximize2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtDate } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/States';

/**
 * Vignette du plan de localisation déposé par l'administration.
 * Le document est soit une image, soit un PDF : la vignette et la vue plein
 * écran s'adaptent au type, sans jamais présumer du format.
 */
export function PlanPreview({ document, isLoading, className, actionLabel = 'Ouvrir le plan' }) {
  const [open, setOpen] = useState(false);

  if (isLoading) return <Skeleton className={cn('h-28 w-full', className)} />;

  if (!document) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface-raised px-3 py-5 text-center',
          className,
        )}
      >
        <ImageOff size={18} aria-hidden="true" className="text-content-faint" />
        <p className="text-xs text-content-muted">Aucun plan déposé pour cet étage.</p>
      </div>
    );
  }

  const isPdf = document.type === 'pdf';

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Agrandir le plan : ${document.name}`}
        className="group relative block w-full overflow-hidden rounded-xl border border-line bg-ink"
      >
        {isPdf ? (
          <span className="flex h-28 flex-col items-center justify-center gap-1.5">
            <FileText size={22} aria-hidden="true" className="text-accent" />
            <span className="px-3 text-xs text-content-muted">Plan au format PDF</span>
          </span>
        ) : (
          <img src={document.url} alt={`Plan de localisation : ${document.name}`} className="h-28 w-full object-cover" />
        )}
        <span className="absolute right-2 top-2 rounded-lg border border-line bg-surface/90 p-1 text-content-muted transition group-hover:text-content">
          <Maximize2 size={12} aria-hidden="true" />
        </span>
      </button>

      <p className="mt-1.5 truncate text-[11px] text-content-faint" title={document.name}>
        {document.name}
        {document.updatedAt ? ` · déposé le ${fmtDate(document.updatedAt)}` : ''}
      </p>

      <Button variant="secondary" size="sm" fullWidth icon={Map} className="mt-2" onClick={() => setOpen(true)}>
        {actionLabel}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={document.name} icon={Map} size="xl">
        {isPdf ? (
          <iframe
            src={document.url}
            title={`Plan de localisation : ${document.name}`}
            className="h-[70vh] w-full rounded-xl border border-line bg-white"
          />
        ) : (
          <img
            src={document.url}
            alt={`Plan de localisation : ${document.name}`}
            className="w-full rounded-xl border border-line"
          />
        )}
        {/* Un plan de salle arrive sans métadonnées de dépôt : afficher
            « déposé par undefined le Invalid Date » vaudrait moins que se taire. */}
        {document.updatedAt && (
          <p className="mt-3 text-xs text-content-muted">
            Déposé par {document.uploadedBy} le {fmtDate(document.updatedAt)} · {document.sizeKo} Ko
          </p>
        )}
      </Modal>
    </div>
  );
}
