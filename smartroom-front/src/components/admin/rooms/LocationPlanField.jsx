import { useRef, useState } from 'react';
import { MapPin, Trash2, Upload } from 'lucide-react';
import { TYPES_PLAN_LOCALISATION } from '../../../api/admin/rooms';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Card';

/**
 * Plan de localisation de la salle.
 *
 * Trois visuels différents coexistent dans l'application, et les confondre
 * mènerait à en montrer un pour l'autre :
 *
 * * les **photos** montrent la salle, et illustrent sa carte dans la recherche ;
 * * le **plan d'étage** vaut pour tout un niveau, et sert à placer les salles
 *   les unes par rapport aux autres — il vit dans l'écran Plans ;
 * * ce **plan de localisation** porte déjà le repère de la salle. C'est une
 *   image annotée, déposée telle quelle, que l'utilisateur consulte pour
 *   trouver son chemin.
 *
 * Une salle peut être située sans que son étage ait reçu de plan, et l'inverse :
 * les deux sont indépendants.
 */
export function LocationPlanField({ src, onUpload, onRemove, busy = false, disabled = false }) {
  const champ = useRef(null);
  const [erreur, setErreur] = useState(null);

  const choisir = async (event) => {
    const fichier = event.target.files?.[0];
    // Remis à zéro tout de suite : sans cela, redéposer le même fichier après
    // un refus n'émettrait aucun événement.
    event.target.value = '';
    if (!fichier) return;

    setErreur(null);
    try {
      await onUpload(fichier);
    } catch (souci) {
      setErreur(souci.message ?? 'Le dépôt a échoué.');
    }
  };

  if (disabled) {
    return (
      <Callout tone="info" title="Plan de localisation">
        Il s’ajoutera une fois la salle créée : le fichier s’attache à un identifiant.
      </Callout>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <MapPin size={15} aria-hidden="true" className="text-content-muted" />
        <div className="min-w-0">
          <p className="text-sm text-content">Plan de localisation</p>
          <p className="text-[11px] text-content-muted">
            Le plan portant le repère de la salle, tel que l’utilisateur le consultera.
            PNG, JPEG ou WebP.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={champ}
            type="file"
            accept={TYPES_PLAN_LOCALISATION.join(',')}
            onChange={choisir}
            className="sr-only"
            aria-label="Choisir le plan de localisation"
          />
          <Button
            variant="secondary"
            size="sm"
            icon={Upload}
            loading={busy}
            onClick={() => champ.current?.click()}
          >
            {src ? 'Remplacer' : 'Déposer'}
          </Button>
          {src && (
            <Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={onRemove}>
              Retirer
            </Button>
          )}
        </div>
      </div>

      {erreur && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {erreur}
        </p>
      )}

      {src ? (
        <img
          src={src}
          alt="Plan de localisation de la salle"
          className="max-h-64 w-full rounded-lg border border-line object-contain"
        />
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-content-faint">
          Aucun plan déposé. Les utilisateurs verront l’adresse et l’étage, sans repère visuel.
        </p>
      )}
    </div>
  );
}
