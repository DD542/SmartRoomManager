import { useRef, useState } from 'react';
import { FileUp, Trash2, Upload } from 'lucide-react';
import { deletePlanDocument, TAILLE_MAX_MO, uploadPlanDocument } from '../../api/buildings';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Card';

const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf';

/**
 * Zone de dépôt du plan de localisation, réservée aux gestionnaires.
 * Accepte une image ou un PDF, par glisser-déposer ou par le sélecteur de
 * fichiers ; le champ reste utilisable au clavier via le bouton « Parcourir ».
 */
export function PlanUpload({ planId, document, onUploaded, className }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const send = async (file) => {
    setPending(true);
    setError(null);
    try {
      const uploaded = await uploadPlanDocument(planId, file);
      toast.success('Plan mis en ligne', `${uploaded.name} est désormais visible par les utilisateurs.`);
      onUploaded?.(uploaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    await deletePlanDocument(planId);
    toast.info('Plan retiré', 'Les utilisateurs ne verront plus de plan pour cet étage.');
    onUploaded?.(null);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          send(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition',
          dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface-raised',
        )}
      >
        <FileUp size={20} aria-hidden="true" className="text-accent" />
        <p className="text-sm text-content">Déposez le plan de l’étage</p>
        <p className="text-xs text-content-muted">
          Image (PNG, JPG, SVG, WebP) ou PDF · {TAILLE_MAX_MO} Mo maximum
        </p>

        <label htmlFor={`plan-${planId}`} className="sr-only">
          Fichier du plan de localisation
        </label>
        <input
          ref={inputRef}
          id={`plan-${planId}`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => send(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={Upload}
          loading={pending}
          className="mt-1"
          onClick={() => inputRef.current?.click()}
        >
          Parcourir les fichiers
        </Button>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      {document && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-xs text-content">{document.name}</span>
            <span className="block text-[11px] text-content-muted">
              {document.type === 'pdf' ? 'PDF' : 'Image'} · {document.sizeKo} Ko · déposé par{' '}
              {document.uploadedBy}
            </span>
          </span>
          <Button variant="danger" size="sm" icon={Trash2} onClick={remove}>
            Retirer
          </Button>
        </div>
      )}
    </div>
  );
}
