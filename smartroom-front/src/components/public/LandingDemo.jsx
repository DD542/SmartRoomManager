import { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { prefersReducedMotion } from '../../hooks/useInView';
import { Reveal } from './Reveal';

/**
 * Le film de démonstration, en motion design, et ses chapitres.
 *
 * Un seul fichier, rendu image par image depuis `video/motion-design.html`
 * (voir `video/rendre-video.mjs`) : il se régénère à l'identique quand
 * l'interface change, au lieu d'être refilmé à la main.
 *
 * Les débuts de chapitre suivent les scènes du film, en secondes. Les
 * changer ici sans changer le film ferait sauter au milieu d'une scène.
 */
const FILM = '/demo-smartroom.webm';
const AFFICHE = '/demo-smartroom.webp';

export const CHAPITRES = [
  { titre: 'Ouverture', debut: 0 },
  { titre: 'Le besoin', debut: 3.6 },
  { titre: 'La recommandation', debut: 8.0 },
  { titre: 'Les conflits', debut: 12.8 },
  { titre: 'La réservation', debut: 17.2 },
  { titre: 'Le pilotage', debut: 21.2 },
];

/** Chapitre en cours à l'instant donné : le dernier dont le début est passé. */
export const chapitreA = (instant) =>
  CHAPITRES.reduce((courant, chapitre, rang) => (instant >= chapitre.debut ? rang : courant), 0);

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
  const [chapitre, setChapitre] = useState(0);

  /** Suit la lecture : le repère dit où l'on en est dans le film. */
  const suivre = useCallback(() => {
    const element = video.current;
    if (element) setChapitre(chapitreA(element.currentTime));
  }, []);

  /** Saute au début d'un chapitre, et lance la lecture si elle ne l'était pas. */
  const allerA = (rang) => {
    const element = video.current;
    setChapitre(rang);
    if (!element) return;
    element.currentTime = CHAPITRES[rang].debut;
    demander(element, setEnLecture);
  };

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
    <section id="demo" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal as="h2" className="font-display text-3xl font-normal tracking-[-0.02em] text-content sm:text-5xl">
          La démonstration <span className="font-extrabold italic">en vidéo</span>
        </Reveal>
        <Reveal
          as="p"
          delay={80}
          className="mt-4 max-w-2xl text-base leading-relaxed text-content-muted md:text-lg"
        >
          Du besoin exprimé au code d’accès reçu, puis au pilotage du parc : le
          parcours complet en moins de trente secondes, en boucle et sans son.
        </Reveal>

        <Reveal delay={160} className="mt-8">
          <div className="verre relative overflow-hidden rounded-[32px] p-2 shadow-haute">
            {/* `aspect-video` : la boîte garde sa forme avant même que la vidéo
                soit chargée, et la page ne saute pas au démarrage. */}
            <div className="aspect-video w-full overflow-hidden rounded-[26px]">
              <video
                ref={video}
                className="h-full w-full"
                // `metadata` et non `auto` : le film ne se télécharge qu'à la
                // lecture, donc à l'entrée dans la fenêtre. Un visiteur qui ne
                // descend jamais jusqu'ici n'en paie rien.
                preload="metadata"
                poster={AFFICHE}
                muted
                playsInline
                loop
                controls
                onTimeUpdate={suivre}
                aria-label={`Démonstration de SmartRoom Manager, chapitre ${chapitre + 1} sur ${
                  CHAPITRES.length
                } : ${CHAPITRES[chapitre].titre}, sans son`}
              >
                <source src={FILM} type="video/webm" />
                Votre navigateur ne sait pas lire cette vidéo.
              </video>
            </div>

            {!enLecture && (
              <button
                type="button"
                onClick={lancerALaMain}
                className="group absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-[26px] bg-surface/30 backdrop-blur-md transition hover:bg-surface/10"
              >
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-corail text-[#0C1547] shadow-haute transition duration-500 ease-ressort group-hover:scale-110">
                  <Play size={30} aria-hidden="true" className="ml-1 fill-current" />
                </span>
                <span className="text-sm text-content">Lancer la démonstration</span>
              </button>
            )}
          </div>

          {/* Les chapitres, et de quoi y sauter. Sans repère, un film qui change
              de scène tout seul ne dit pas ce qu'il reste à voir. */}
          <nav aria-label="Chapitres de la démonstration" className="mt-4 flex flex-wrap gap-2">
            {CHAPITRES.map(({ titre }, rang) => (
              <button
                key={titre}
                type="button"
                onClick={() => allerA(rang)}
                aria-current={rang === chapitre ? 'true' : undefined}
                className={`pression inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors ${
                  rang === chapitre
                    ? 'bg-corail text-[#0C1547] shadow-[0_10px_22px_-10px_rgb(255_128_83/0.8)]'
                    : 'verre text-content-muted hover:text-content'
                }`}
              >
                <span className={rang === chapitre ? 'opacity-70' : 'text-content-faint'}>
                  {String(rang + 1).padStart(2, '0')}
                </span>
                {titre}
              </button>
            ))}
          </nav>
        </Reveal>
      </div>
    </section>
  );
}
