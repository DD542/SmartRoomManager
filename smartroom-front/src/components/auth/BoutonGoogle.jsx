import { useEffect, useRef, useState } from 'react';
import { getGoogleConfig } from '../../api/auth';
import { Spinner } from '../ui/States';

/** Adresse du script d'identité de Google. Aucun paquet n'est ajouté au projet. */
const SCRIPT = 'https://accounts.google.com/gsi/client';

/**
 * Charge le script une seule fois, quel que soit le nombre d'écrans qui le
 * demandent. Deux insertions du même script réinitialiseraient la bibliothèque
 * sous les boutons déjà rendus.
 */
let chargement = null;

function chargerScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (chargement) return chargement;

  chargement = new Promise((resoudre, rejeter) => {
    const balise = document.createElement('script');
    balise.src = SCRIPT;
    balise.async = true;
    balise.defer = true;
    balise.onload = () => resoudre();
    balise.onerror = () => {
      // Une extension de blocage, un réseau qui filtre, une coupure : la
      // promesse est oubliée pour qu'un second essai reparte de zéro.
      chargement = null;
      rejeter(new Error('script'));
    };
    document.head.appendChild(balise);
  });

  return chargement;
}

/**
 * Bouton « Se connecter avec Google ».
 *
 * C'est Google qui le dessine, par `renderButton`. Deux raisons, l'une
 * juridique et l'autre pratique : leurs conditions d'utilisation imposent leur
 * propre bouton, et lui seul ouvre la fenêtre de choix de compte dans les
 * conditions que la bibliothèque attend.
 *
 * Rien ne s'affiche tant que le serveur n'a pas dit que la connexion Google
 * est configurée. Un bouton présent qui échoue à chaque clic est pire que pas
 * de bouton : il fait croire à une panne là où il n'y a qu'une option non
 * activée.
 *
 * Le séparateur « ou » fait partie du composant, et non de l'écran qui
 * l'appelle : posé à côté, il restait seul au milieu de la page quand la
 * connexion Google n'était pas configurée — un « ou » qui n'introduit rien.
 */
export function BoutonGoogle({ onCredential, onError, disabled = false }) {
  const cible = useRef(null);
  const [etat, setEtat] = useState('chargement');

  // Le rappel est gardé dans une référence : la bibliothèque de Google ne
  // relit jamais sa configuration, et une fonction changée au rendu suivant
  // ne lui parviendrait pas.
  const rappel = useRef({ onCredential, onError });
  rappel.current = { onCredential, onError };

  useEffect(() => {
    let vivant = true;

    (async () => {
      try {
        const config = await getGoogleConfig();
        if (!vivant) return;

        if (!config.enabled) {
          setEtat('inactif');
          return;
        }

        await chargerScript();
        if (!vivant || !cible.current) return;

        window.google.accounts.id.initialize({
          client_id: config.clientId,
          callback: ({ credential }) => rappel.current.onCredential?.(credential),
          // La sélection automatique ouvrirait une session sans que personne
          // l'ait demandé, au simple chargement de la page.
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        window.google.accounts.id.renderButton(cible.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          locale: 'fr',
          width: 320,
        });

        setEtat('pret');
      } catch {
        if (!vivant) return;
        setEtat('erreur');
        rappel.current.onError?.(
          'La connexion Google n’a pas pu être chargée. Utilisez votre adresse et votre mot de passe.',
        );
      }
    })();

    return () => {
      vivant = false;
    };
  }, []);

  if (etat === 'inactif') return null;

  if (etat === 'erreur') {
    return (
      <p className="mt-5 text-center text-xs text-content-faint">
        Connexion Google indisponible sur ce poste.
      </p>
    );
  }

  return (
    <>
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-content-muted">ou</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex justify-center">
        {etat === 'chargement' && <Spinner label="Chargement de la connexion Google…" />}
        {/* Le conteneur reste monté pendant le chargement : Google y dessine
            son bouton, et le retirer du DOM entre-temps lui ferait perdre sa
            cible. */}
        <div
          ref={cible}
          className={disabled ? 'pointer-events-none opacity-50' : undefined}
          style={etat === 'pret' ? undefined : { display: 'none' }}
        />
      </div>
    </>
  );
}
