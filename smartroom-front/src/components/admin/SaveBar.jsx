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
    // Ancrée au bas de la zone de contenu, marge du système comprise. En
    // dessous de 640 px elle prend toute la largeur : « au plus juste », elle
    // devenait trois lignes centrées où l'on ne savait plus quel bouton
    // enregistrait. `role="region"` et son libellé : c'est une zone qui
    // apparaît d'elle-même, un lecteur d'écran doit pouvoir la retrouver.
    <div
      role="region"
      aria-label="Modifications en attente"
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-sticky mx-auto flex w-full flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-2.5 sm:w-fit sm:max-w-full"
    >
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
