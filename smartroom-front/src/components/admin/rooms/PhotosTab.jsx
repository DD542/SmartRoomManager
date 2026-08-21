import { useRef, useState } from 'react';
import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Card';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const TAILLE_MAX_MO = 2;

/**
 * A-06 — onglet Photos.
 *
 * Le premier visuel est celui des cartes de recherche : il se choisit
 * explicitement plutôt que d'être le hasard de l'ordre de dépôt.
 */
export function PhotosTab({ photos = [], onAdd, onRemove, onCover, busy = false }) {
  const inputRef = useRef(null);
  const [erreur, setErreur] = useState(null);

  const lire = (fichier) => {
    setErreur(null);
    if (!fichier) return;
    if (!ACCEPT.split(',').includes(fichier.type)) {
      setErreur('Format non accepté : PNG, JPEG, WebP ou SVG.');
      return;
    }
    if (fichier.size > TAILLE_MAX_MO * 1024 * 1024) {
      setErreur(`Fichier trop lourd : ${TAILLE_MAX_MO} Mo au maximum.`);
      return;
    }
    // Le back recevra le fichier ; la maquette le convertit en data URI pour
    // rester entièrement hors ligne, sans stockage ni requête.
    const lecteur = new FileReader();
    lecteur.onload = () => onAdd(String(lecteur.result));
    lecteur.onerror = () => setErreur('Lecture du fichier impossible.');
    lecteur.readAsDataURL(fichier);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-content-muted">
        Six visuels au maximum. Le premier illustre la salle dans les résultats de recherche.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo, index) => (
          <li
            key={index}
            className={cn(
              'group relative overflow-hidden rounded-xl border',
              index === 0 ? 'border-accent' : 'border-line',
            )}
          >
            <img src={photo} alt={`Visuel ${index + 1}`} className="h-28 w-full object-cover" />

            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-ink/85 px-2 py-1.5">
              <span className="text-[11px] text-content-muted">
                {index === 0 ? 'Visuel principal' : `Visuel ${index + 1}`}
              </span>
              <span className="flex items-center gap-1">
                {index !== 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    icon={Star}
                    aria-label={`Choisir le visuel ${index + 1} comme principal`}
                    disabled={busy}
                    onClick={() => onCover(index)}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  icon={Trash2}
                  aria-label={`Supprimer le visuel ${index + 1}`}
                  disabled={busy || photos.length <= 1}
                  onClick={() => onRemove(index)}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>

      {erreur && <Callout tone="danger">{erreur}</Callout>}

      <div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            lire(event.target.files?.[0]);
            // Réinitialisation : sans cela, redéposer le même fichier ne
            // déclencherait aucun événement.
            event.target.value = '';
          }}
        />
        <Button
          variant="secondary"
          icon={ImagePlus}
          loading={busy}
          disabled={photos.length >= 6}
          onClick={() => inputRef.current?.click()}
        >
          Ajouter un visuel
        </Button>
      </div>
    </div>
  );
}
