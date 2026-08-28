import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { TYPES_PHOTO } from '../../api/auth';
import { Avatar } from '../ui/Avatar';
import { AvatarCropper } from './AvatarCropper';
import { Button } from '../ui/Button';

/**
 * Dépôt et retrait de la photo de profil.
 *
 * Le champ de fichier reste caché derrière un bouton : celui du navigateur ne
 * se met pas au style du reste, et le remplacer par un bouton qui le déclenche
 * est le seul moyen d'obtenir la même apparence sans perdre l'accès au clavier
 * — le bouton en garde tous les comportements.
 *
 * Le format et le poids sont contrôlés avant l'envoi *et* par le serveur. Le
 * contrôle local n'est pas une sécurité, c'est une réponse immédiate : refuser
 * un fichier de huit mégaoctets après l'avoir téléversé serait discourtois.
 */
export function AvatarField({ name, src, onUpload, onRemove, busy = false }) {
  const champ = useRef(null);
  const [erreur, setErreur] = useState(null);
  // La photo choisie attend son cadrage : rien n'est envoyé avant que
  // l'utilisateur ait dit quel carré il veut voir.
  const [aCadrer, setACadrer] = useState(null);

  const choisir = (event) => {
    const fichier = event.target.files?.[0];
    // Le champ est remis à zéro tout de suite : sans cela, redéposer le même
    // fichier après un échec n'émettrait aucun événement.
    event.target.value = '';
    if (!fichier) return;

    setErreur(null);
    setACadrer(fichier);
  };

  const envoyer = async (cadree) => {
    try {
      await onUpload(cadree);
      setACadrer(null);
    } catch (souci) {
      setACadrer(null);
      setErreur(souci.message ?? 'Le dépôt a échoué.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <AvatarCropper
        file={aCadrer}
        busy={busy}
        onCancel={() => setACadrer(null)}
        onValidate={envoyer}
      />
      <Avatar name={name} src={src} size="xl" />

      <div className="min-w-0">
        <p className="text-sm font-medium text-content">Photo de profil</p>
        <p className="text-xs text-content-muted">PNG, JPEG ou WebP, jusqu’à 5 Mo.</p>
        {erreur && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {erreur}
          </p>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <input
          ref={champ}
          type="file"
          accept={TYPES_PHOTO.join(',')}
          onChange={choisir}
          className="sr-only"
          // Étiqueté malgré son invisibilité : un lecteur d'écran l'atteint par
          // la navigation en formulaire, où le bouton ne le précède pas.
          aria-label="Choisir une photo de profil"
        />
        <Button
          variant="secondary"
          size="sm"
          icon={Upload}
          loading={busy}
          onClick={() => champ.current?.click()}
        >
          {src ? 'Changer la photo' : 'Ajouter une photo'}
        </Button>
        {src && (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            disabled={busy}
            onClick={() => {
              setErreur(null);
              onRemove();
            }}
          >
            Retirer
          </Button>
        )}
      </div>
    </div>
  );
}
