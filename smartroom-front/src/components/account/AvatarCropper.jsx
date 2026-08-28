import { useEffect, useRef, useState } from 'react';
import { Crop } from 'lucide-react';
import { apercu, cadreSource, zoomMax } from '../../utils/cadrage';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * Recadrage de la photo de profil, avant l'envoi.
 *
 * L'application rognait au centre : sur une photo de téléphone — un portrait
 * en pied, le plus souvent — cela gardait le buste et coupait le visage. Vu
 * dans un rond de 44 px en haut de l'écran, il ne restait plus rien de
 * reconnaissable, et la photo passait pour floue alors qu'elle ne l'était pas.
 *
 * L'utilisateur choisit donc lui-même : il déplace et resserre le cadre sur
 * son visage, et c'est ce carré-là qui part, en 512 × 512. La photo affichée
 * n'est plus la réduction d'un plan large mais un portrait, et le visage
 * occupe toute la vignette.
 *
 * Aucune bibliothèque : un `<img>` positionné, un curseur, et un canevas.
 */

const FENETRE = 288;
const SORTIE = 512;

export function AvatarCropper({ file, onValidate, onCancel, busy = false }) {
  const [source, setSource] = useState(null);
  const [image, setImage] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const glisse = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const adresse = URL.createObjectURL(file);
    setSource(adresse);
    setZoom(1);
    setDecalage({ x: 0, y: 0 });
    // L'adresse d'objet est révoquée à la fermeture : sans cela, chaque photo
    // essayée resterait en mémoire jusqu'au rechargement de la page.
    return () => URL.revokeObjectURL(adresse);
  }, [file]);

  if (!file) return null;

  const largeur = image?.naturalWidth ?? 0;
  const hauteur = image?.naturalHeight ?? 0;
  const pret = largeur > 0 && hauteur > 0;
  const cadre = pret
    ? cadreSource({ largeur, hauteur, zoom, decalageX: decalage.x, decalageY: decalage.y })
    : null;
  const vue = cadre ? apercu(cadre, largeur, hauteur, FENETRE) : null;
  const maximum = pret ? zoomMax(largeur, hauteur, SORTIE) : 1;

  // Un pixel d'écran vaut `cadre.cote / FENETRE` pixels de l'original : le
  // déplacement suit donc le doigt, quel que soit le zoom.
  const deplacer = (event) => {
    if (!glisse.current || !cadre) return;
    const facteur = cadre.cote / FENETRE;
    setDecalage({
      x: glisse.current.depart.x - (event.clientX - glisse.current.souris.x) * facteur,
      y: glisse.current.depart.y - (event.clientY - glisse.current.souris.y) * facteur,
    });
  };

  const decouper = () => {
    const canevas = document.createElement('canvas');
    canevas.width = SORTIE;
    canevas.height = SORTIE;
    const pinceau = canevas.getContext('2d');
    if (!pinceau) throw new Error('Le recadrage est indisponible sur ce navigateur.');

    pinceau.drawImage(image, cadre.x, cadre.y, cadre.cote, cadre.cote, 0, 0, SORTIE, SORTIE);
    canevas.toBlob(
      (blob) => {
        if (!blob) return;
        onValidate(new File([blob], 'photo-de-profil.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title="Cadrer votre photo"
      description="Déplacez et resserrez le cadre sur votre visage."
      icon={Crop}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
          <Button icon={Crop} onClick={decouper} loading={busy} disabled={!pret}>
            Enregistrer cette photo
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          role="presentation"
          onPointerDown={(event) => {
            glisse.current = {
              souris: { x: event.clientX, y: event.clientY },
              depart: { ...decalage },
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={deplacer}
          onPointerUp={() => {
            glisse.current = null;
          }}
          className="relative overflow-hidden rounded-full border border-line bg-ink"
          style={{ width: FENETRE, height: FENETRE, touchAction: 'none', cursor: 'grab' }}
        >
          {source && (
            <img
              src={source}
              alt="Photo à cadrer"
              onLoad={(event) => setImage(event.currentTarget)}
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={vue ?? { visibility: 'hidden' }}
            />
          )}
        </div>

        {/* Ce que donnera le cadrage, aux deux tailles où la photo est vue.
            Sans cela, on ajuste à l'aveugle : le cercle de 288 px flatte un
            plan large que la barre du haut réduit à un point. */}
        <div className="flex items-end gap-3">
          {[
            { taille: 44, legende: 'Barre du haut' },
            { taille: 112, legende: 'Profil' },
          ].map(({ taille, legende }) => (
            <figure key={taille} className="flex flex-col items-center gap-1">
              <span
                className="relative block overflow-hidden rounded-full border border-line bg-ink"
                style={{ width: taille, height: taille }}
              >
                {source && cadre && (
                  <img
                    src={source}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute max-w-none select-none"
                    style={apercu(cadre, largeur, hauteur, taille)}
                  />
                )}
              </span>
              <figcaption className="text-[10px] text-content-faint">{legende}</figcaption>
            </figure>
          ))}
        </div>

        <label className="flex w-full max-w-xs items-center gap-3 text-xs text-content-muted">
          Zoom
          <input
            type="range"
            min={1}
            max={Math.max(1.01, maximum)}
            step={0.01}
            value={zoom}
            disabled={!pret || maximum <= 1}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="flex-1 accent-accent"
            aria-label="Resserrer le cadre"
          />
        </label>

        <p className="text-center text-xs text-content-faint">
          La photo est enregistrée en {SORTIE} × {SORTIE} pixels, carrée.
        </p>
      </div>
    </Modal>
  );
}
