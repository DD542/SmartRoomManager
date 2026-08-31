import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Reveal } from './Reveal';

/**
 * P-01 — ancre #demo : la démonstration filmée du produit.
 *
 * Posée après les problèmes et avant les fonctionnalités : le visiteur vient
 * de lire ce qui ne va pas, la vidéo montre le produit en marche, et les
 * sections suivantes détaillent. Une démonstration placée en fin de page
 * n'est vue que par ceux qui étaient déjà convaincus.
 *
 * **Aucune lecture automatique.** Une vidéo qui démarre seule consomme le
 * forfait de qui n'a rien demandé, et déplace l'attention hors du texte que
 * le visiteur est en train de lire. Elle n'est chargée qu'au premier clic :
 * `preload="none"` évite 1,7 Mo à chaque ouverture de la page d'accueil, dont
 * la plupart des visiteurs ne regarderont jamais la vidéo.
 *
 * L'affiche est une image fixe du produit dessinée en CSS plutôt qu'un fichier
 * de plus : c'est une surface de clic, pas une photographie.
 */
export function LandingDemo() {
  const video = useRef(null);
  const [demarree, setDemarree] = useState(false);

  const lancer = () => {
    setDemarree(true);
    // Le rendu qui suit retire l'affiche ; la lecture part au tour d'après,
    // quand l'élément porte enfin ses contrôles.
    queueMicrotask(() => video.current?.play());
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
          l’application.
        </Reveal>

        <Reveal delay={160} className="mt-8">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
            {/* `aspect-video` : la boîte garde sa forme avant même que la vidéo
                soit chargée, et la page ne saute pas au démarrage. */}
            <div className="aspect-video w-full">
              <video
                ref={video}
                className="h-full w-full"
                preload="none"
                controls={demarree}
                playsInline
                aria-label="Démonstration de SmartRoom Manager"
              >
                <source src="/demo.mp4" type="video/mp4" />
                Votre navigateur ne sait pas lire cette vidéo.
              </video>
            </div>

            {!demarree && (
              <button
                type="button"
                onClick={lancer}
                className="group absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface transition hover:bg-surface-raised"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-accent bg-accent-soft transition duration-300 group-hover:scale-110">
                  <Play size={26} aria-hidden="true" className="ml-1 text-accent" />
                </span>
                <span className="text-sm text-content">Lancer la démonstration</span>
                <span className="text-xs text-content-faint">
                  La vidéo n’est téléchargée qu’à la lecture.
                </span>
              </button>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
