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
 * `initialize` n'est appelé qu'une fois, et le jeton distribué aux boutons
 * effectivement montés.
 *
 * La bibliothèque le dit en console quand on s'y prend mal : « initialize() is
 * called multiple times [...] only the last initialized instance will be
 * used ». En mode strict, React monte, démonte et remonte chaque effet ; sans
 * ce garde-fou, le composant réinitialisait Google sous le bouton déjà
 * dessiné à chaque montage.
 *
 * Le rappel passé à Google ne peut donc pas appartenir à une instance : il
 * appartient au module, et sert ceux qui sont là au moment où le jeton
 * arrive. Un bouton démonté se retire de la liste et ne reçoit plus rien.
 */
let clientInitialise = null;
let bibliothequeInitialisee = null;
const destinataires = new Set();

function initialiser(clientId) {
  const bibliotheque = window.google.accounts.id;

  // La bibliothèque elle-même fait partie de la condition, pas seulement
  // l'identifiant de client : un script rechargé est une instance neuve, qui
  // ne sait rien de ce qu'on a dit à la précédente. S'en souvenir à sa place
  // laisserait un bouton muet.
  if (clientInitialise === clientId && bibliothequeInitialisee === bibliotheque) return;

  bibliotheque.initialize({
    client_id: clientId,
    callback: ({ credential }) => {
      destinataires.forEach((remettre) => remettre(credential));
    },
    // La sélection automatique ouvrirait une session sans que personne
    // l'ait demandé, au simple chargement de la page.
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  clientInitialise = clientId;
  bibliothequeInitialisee = bibliotheque;
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

  //: Arrêt de la surveillance de largeur, posé une fois le bouton dessiné.
  const nettoyage = useRef(() => {});

  useEffect(() => {
    let vivant = true;

    /**
     * (Re)dessine le bouton à la largeur de son conteneur.
     *
     * Google impose son propre bouton — leurs conditions l'exigent, et lui
     * seul ouvre la fenêtre de choix de compte. Restent quatre réglages, et
     * `outline` est celui qui tient sur un fond sombre : `filled_black` y
     * creuse un trou noir, faute de bordure pour marquer ses limites.
     */
    const dessiner = () => {
      if (!cible.current) return;
      const disponible = cible.current.parentElement?.clientWidth ?? 320;
      // Google refuse en dehors de cette plage, sans le dire.
      const largeur = Math.max(200, Math.min(400, Math.round(disponible)));

      cible.current.innerHTML = '';
      window.google.accounts.id.renderButton(cible.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'center',
        locale: 'fr',
        width: largeur,
      });
    };

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

        const surveillants = [];

        initialiser(config.clientId);

        const remettre = (credential) => rappel.current.onCredential?.(credential);
        destinataires.add(remettre);
        surveillants.push(() => destinataires.delete(remettre));

        dessiner();
        setEtat('pret');

        // La largeur est un nombre de pixels, pas un pourcentage : Google
        // n'accepte que cela, et le bouton ne se redimensionne pas tout seul.
        // Il est donc redessiné quand la place change — sans quoi il gardait
        // sa largeur d'origine et débordait de la carte sur un téléphone.
        //
        // Deux sources, parce qu'aucune ne suffit seule. `ResizeObserver` voit
        // les changements que la fenêtre ignore — un volet qui s'ouvre, une
        // carte qui rétrécit — mais il ne se déclenche pas dans un document
        // que le navigateur ne peint pas, ce qui arrive plus souvent qu'on ne
        // croit : onglet en arrière-plan, fenêtre jamais composée. L'événement
        // `resize`, lui, arrive partout, et couvre le cas le plus fréquent.
        if (typeof ResizeObserver !== 'undefined') {
          const surveillant = new ResizeObserver(dessiner);
          surveillant.observe(cible.current.parentElement);
          surveillants.push(() => surveillant.disconnect());
        }

        window.addEventListener('resize', dessiner);
        surveillants.push(() => window.removeEventListener('resize', dessiner));

        nettoyage.current = () => surveillants.forEach((arreter) => arreter());
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
      nettoyage.current();
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

      {/* `w-full` : c'est ce conteneur que le bouton mesure pour se dessiner,
          il doit donc porter la largeur de la carte, pas celle de son
          contenu. */}
      <div className="flex w-full justify-center">
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
