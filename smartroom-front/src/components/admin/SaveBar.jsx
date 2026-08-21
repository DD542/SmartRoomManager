import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Barre d'enregistrement des écrans de configuration.
 *
 * Elle ne s'affiche qu'en présence de modifications non enregistrées : c'est
 * elle qui empêche de quitter un écran de réglages en croyant avoir sauvegardé.
 */
export function SaveBar({ dirty, saving = false, valid = true, message, onCancel, onSave, saveLabel = 'Enregistrer les modifications' }) {
  if (!dirty) {
    return message ? (
      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-success">
        <CheckCircle2 size={14} aria-hidden="true" />
        {message}
      </div>
    ) : null;
  }

  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-content-muted">
        <AlertCircle size={14} aria-hidden="true" className={valid ? 'text-warning' : 'text-danger'} />
        {valid ? 'Modifications non enregistrées' : message}
      </span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Annuler
      </Button>
      <Button size="sm" loading={saving} disabled={!valid} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}
