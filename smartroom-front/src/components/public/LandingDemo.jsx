import { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { prefersReducedMotion } from '../../hooks/useInView';
import { Reveal } from './Reveal';

/**
 * Les sept séquences, dans l'ordre où elles se lisent.
 *
 * Enchaînées par le lecteur plutôt que fusionnées en un seul fichier : aucun
 * outil d'encodage n'est installé sur la machine, et un ré-encodage aurait de
 * toute façon coûté une génération de qualité pour un résultat identique à
 * l'œil.
 *
 * Chaque séquence garde donc son fichier, et seule celle qu'on regarde est
 * téléchargée. Quinze mégaoctets d'un coup pour un visiteur qui s'arrête au
 * premier plan serait un mauvais échange.
 */
const SEQUENCES = [
  '/demo1.mp4',
  '/demo2.mp4',
  '/demo3.mp4',
  '/demo4.mp4',
  '/demo5.mp4',
  '/demo6.mp4',
  '/demo7.mp4',
];

/**
 * Demande la lecture, et note si elle a été obtenue.
 *
 * `play()` rend une promesse — mais la spécification ne l'a imposé que
 * tardivement, et rien n'oblige un environnement à la fournir : jsdom rend
 * `undefined`. Enchaîner un `.then` dessus casse alors le montage du
 * composant. Sans promesse, on ne peut pas savoir si la lecture a démarré :
 * l'affiche reste, avec son bouton, ce qui est le bon défaut — un cadre noir
 * qu'on ne peut pas lancer serait le mauvais.
 */
function demander(element, noter) {
  const lecture = element.play();
  if (!lecture?.then) return;
  // Refus du navigateur — économie d'énergie, réglage utilisateur : l'affiche
  // et son bouton restent.
  lecture.then(() => noter(true)).catch(() => noter(false));
}

/**
 * P-01 — ancre #demo : la démonstration filmée du produit.
 *
 * Posée après les problèmes et avant les fonctionnalités : le visiteur vient
 * de lire ce qui ne va pas, la vidéo montre le produit en marche, et les
 * sections suivantes détaillent. Une démonstration placée en fin de page
 * n'est vue que par ceux qui étaient déjà convaincus.
 *
 * **Lecture automatique, sans son.** Trois conditions pour qu'elle parte
 * vraiment, et non pour qu'elle soit seulement demandée :
 *
 *   1. `muted` — aucun navigateur ne lance une vidéo sonore sans geste, et
 *      une page d'accueil qui parle toute seule serait de toute façon fermée.
 *   2. `playsInline` — sans lui, Safari sur iPhone ouvre le lecteur plein
 *      écran au lieu de jouer dans la page.
 *   3. Un geste de repli : si le navigateur refuse quand même — mode économie
 *      d'énergie, réglage de l'utilisateur —, `play()` est rejetée et
 *      l'affiche reste, avec son bouton. Une vidéo qui ne part pas et qu'on ne
 *      peut pas lancer serait un cadre noir.
 *
 * La lecture suit le regard : elle démarre à l'entrée dans la fenêtre et
 * s'arrête à la sortie. Faire tourner huit secondes en boucle sous une section
 * qu'on ne regarde pas consomme de la batterie et du forfait pour rien.
 *
 * `prefers-reduced-motion` est respecté : qui a demandé moins d'animation ne
 * reçoit pas une vidéo qui démarre seule, mais l'affiche et son bouton.
 */
export function LandingDemo() {
  const video = useRef(null);
  //: Décidé une fois au montage : ce réglage ne change pas en cours de visite,
  //: et le relire à chaque rendu ferait dépendre le comportement du hasard des
  //: re-rendus.
  const [automatique] = useState(() => !prefersReducedMotion());
  const [enLecture, setEnLecture] = useState(false);
  const [index, setIndex] = useState(0);

  /**
   * Passe à la séquence suivante, et revient à la première après la dernière.
   *
   * L'enchaînement se fait ici et non par l'attribut `loop`, qui reboucle sur
   * le fichier courant : sept séquences dans l'ordre demandent un compteur,
   * pas un drapeau.
   */
  const suivante = useCallback(
    () => setIndex((courant) => (courant + 1) % SEQUENCES.length),
    [],
  );

  // Changement de séquence : la source suit l'index et la lecture reprend
  // aussitôt. `load()` est nécessaire — changer la source ne suffit pas à
  // faire relire l'élément, qui garderait la séquence précédente.
  useEffect(() => {
    const element = video.current;
    if (!element || !enLecture) return;
    element.load();
    demander(element, setEnLecture);
    // `enLecture` volontairement hors des dépendances : cet effet suit le
    // changement de séquence, pas le passage de l'affiche à la lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const element = video.current;
    if (!automatique || !element) return undefined;

    const lancer = () => demander(element, setEnLecture);

    if (typeof IntersectionObserver === 'undefined') {
      lancer();
      return undefined;
    }

    // Déjà à l'écran au montage : on lance sans attendre l'observateur.
    // Celui-ci ne répond qu'après une peinture, et il en existe qui n'arrivent
    // jamais — onglet ouvert en arrière-plan, fenêtre jamais composée. La
    // vidéo resterait alors figée sous son affiche alors qu'elle occupe
    // l'écran. `useInView` prend déjà la même précaution, pour la même raison.
    const cadre = element.getBoundingClientRect();
    const hauteur = window.innerHeight || document.documentElement.clientHeight;
    if (cadre.top < hauteur && cadre.bottom > 0) lancer();

    const observateur = new IntersectionObserver(
      (entrees) => {
        entrees.forEach((entree) => {
          if (entree.isIntersecting) lancer();
          else element.pause();
        });
      },
      // Un tiers visible : assez pour dire qu'on la regarde, pas assez pour
      // qu'elle démarre au moment où son premier pixel affleure l'écran.
      { threshold: 0.35 },
    );
    observateur.observe(element);

    // Onglet ouvert en arrière-plan : le document est « hidden », et le
    // navigateur refuse d'y démarrer une lecture — mesuré, `play()` est
    // rejetée. Sans ce rattrapage, la page revenue au premier plan garderait
    // son affiche figée sur une vidéo qui aurait dû tourner.
    const reprendre = () => {
      if (document.visibilityState === 'visible' && element.paused) lancer();
    };
    document.addEventListener('visibilitychange', reprendre);

    return () => {
      observateur.disconnect();
      document.removeEventListener('visibilitychange', reprendre);
    };
  }, [automatique]);

  const lancerALaMain = () => {
    if (video.current) demander(video.current, setEnLecture);
  };

  return (
    <section id="demo" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <Reveal as="h2" className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          La démonstration en vidéo
        </Reveal>
        <Reveal
          as="p"
          delay={80}
          className="mt-3 max-w-2xl text-sm leading-relaxed text-content-muted"
        >
          Du besoin exprimé au code d’accès reçu : le parcours complet, filmé dans
          l’application. Sept séquences s’enchaînent, en boucle et sans son.
        </Reveal>

        <Reveal delay={160} className="mt-8">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
            {/* `aspect-video` : la boîte garde sa forme avant même que la vidéo
                soit chargée, et la page ne saute pas au démarrage. */}
            <div className="aspect-video w-full">
              <video
                ref={video}
                className="h-full w-full"
                // `metadata` et non `auto` : la séquence ne se télécharge qu'à
                // la lecture, donc à l'entrée dans la fenêtre. Un visiteur qui
                // ne descend jamais jusqu'ici n'en paie aucune des sept.
                preload="metadata"
                muted
                playsInline
                controls
                onEnded={suivante}
                aria-label={`Démonstration de SmartRoom Manager, séquence ${
                  index + 1
                } sur ${SEQUENCES.length}, sans son`}
              >
                <source src={SEQUENCES[index]} type="video/mp4" />
                Votre navigateur ne sait pas lire cette vidéo.
              </video>
            </div>

            {!enLecture && (
              <button
                type="button"
                onClick={lancerALaMain}
                className="group absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface transition hover:bg-surface-raised"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-accent bg-accent-soft transition duration-300 group-hover:scale-110">
                  <Play size={26} aria-hidden="true" className="ml-1 text-accent" />
                </span>
                <span className="text-sm text-content">Lancer la démonstration</span>
              </button>
            )}
          </div>

          {/* La position dans la suite, et de quoi y sauter. Sans repère, une
              séquence qui change toute seule se lit comme un saut de lecture. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-content-faint">
              Séquence {index + 1} sur {SEQUENCES.length}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {SEQUENCES.map((source, position) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={`Séquence ${position + 1}`}
                  aria-current={position === index ? 'true' : undefined}
                  className={`h-1.5 w-7 rounded-full transition ${
                    position === index ? 'bg-accent' : 'bg-line hover:bg-line-strong'
                  }`}
                />
              ))}
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
