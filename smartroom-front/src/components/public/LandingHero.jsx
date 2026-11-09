import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { prefersReducedMotion, useInView } from '../../hooks/useInView';
import { getPublicStats } from '../../api/stats';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/States';
import { AppPreview } from './AppPreview';
import { Reveal } from './Reveal';

/**
 * Chiffre qui monte de zéro à sa valeur, à l'entrée dans la fenêtre.
 *
 * Le compte est arrondi à chaque image et non interpolé en CSS : un nombre
 * doit rester lisible pendant qu'il défile, et une transformation le rendrait
 * flou. La durée est courte — au-delà d'une seconde, on attend un chiffre au
 * lieu de lire une page.
 */
function Compteur({ valeur }) {
  const [cible, vu] = useInView({ seuil: 0.4 });
  const [affiche, setAffiche] = useState(0);

  useEffect(() => {
    if (!vu) return undefined;
    if (valeur === 0 || prefersReducedMotion()) {
      setAffiche(valeur);
      return undefined;
    }

    const debut = performance.now();
    const duree = 900;
    let image = 0;

    const avancer = (maintenant) => {
      const avancement = Math.min(1, (maintenant - debut) / duree);
      // Décélération cubique : rapide au départ, posée à l'arrivée.
      setAffiche(Math.round(valeur * (1 - (1 - avancement) ** 3)));
      if (avancement < 1) image = requestAnimationFrame(avancer);
    };

    image = requestAnimationFrame(avancer);
    return () => cancelAnimationFrame(image);
  }, [vu, valeur]);

  return (
    <dd ref={cible} className="font-display text-3xl font-semibold tracking-tight text-content tabular-nums">
      {affiche}
    </dd>
  );
}

function StatBand({ stats, isLoading }) {
  // Les valeurs viennent du catalogue réel ; seuls les libellés sont ceux de la maquette.
  const items = stats
    ? [
        { value: stats.rooms, label: 'Salles connectées' },
        { value: stats.buildings, label: 'Bâtiments équipés' },
        { value: stats.doubleBookings, label: 'Double réservation' },
      ]
    : [];

  if (isLoading) {
    return (
      <dl className="verre mx-auto mt-12 grid max-w-xl grid-cols-3 gap-6 rounded-3xl px-6 py-5">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton rounded="rounded" className="h-7 w-12" />
            <Skeleton rounded="rounded" className="h-3 w-24" />
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="verre mx-auto mt-12 grid max-w-xl grid-cols-3 gap-6 rounded-3xl px-6 py-5">
      {items.map((item) => (
        // flex-col-reverse : la valeur s'affiche au-dessus, l'ordre du DOM reste terme puis définition.
        <div key={item.label} className="flex flex-col-reverse items-center gap-1 text-center">
          <dt className="text-xs text-content-muted">{item.label}</dt>
          <Compteur valeur={item.value} />
        </div>
      ))}
    </dl>
  );
}

/**
 * Inclinaison de l'aperçu au défilement.
 *
 * L'aperçu part couché vers l'arrière et légèrement réduit, puis se redresse
 * à mesure que la page descend — l'entrée en scène des appareils sur les
 * pages produit d'Apple. La progression est écrite dans une variable CSS :
 * React ne rend rien pendant le défilement, le navigateur compose seul.
 */
function useRedressement() {
  const cible = useRef(null);

  useEffect(() => {
    const element = cible.current;
    if (!element || prefersReducedMotion()) return undefined;

    let image = 0;
    const mesurer = () => {
      image = 0;
      const { top } = element.getBoundingClientRect();
      const hauteur = window.innerHeight || 1;
      // 0 quand le haut de l'aperçu touche le bas de l'écran, 1 quand il
      // atteint le premier tiers.
      const avancement = Math.min(1, Math.max(0, (hauteur - top) / (hauteur * 0.66)));
      element.style.setProperty('--redressement', avancement.toFixed(3));
    };
    const demander = () => {
      if (!image) image = requestAnimationFrame(mesurer);
    };

    mesurer();
    window.addEventListener('scroll', demander, { passive: true });
    window.addEventListener('resize', demander);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener('scroll', demander);
      window.removeEventListener('resize', demander);
    };
  }, []);

  return cible;
}

/** P-01 — bandeau d'ouverture : promesse, actions, aperçu de l'application. */
export function LandingHero() {
  const { data: stats, isLoading } = useAsync(getPublicStats, []);
  const apercu = useRedressement();

  return (
    <section className="relative overflow-hidden">
      {/* Halos pêche, lavande et corail qui dérivent derrière le titre : la
          lumière chaude du bandeau de MentorGoal, animée à la manière des
          pages produit d'Apple. Décor seulement. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="halo-derive absolute left-1/2 top-[38%] h-[34rem] w-[52rem] -translate-x-1/2 rounded-full bg-peche/60 blur-3xl" />
        <div className="halo-derive absolute -left-24 top-10 h-80 w-[30rem] rounded-full bg-lavande/60 blur-3xl [animation-delay:-5s]" />
        <div className="halo-derive absolute -right-24 top-40 h-72 w-[26rem] rounded-full bg-corail/25 blur-3xl [animation-delay:-9s]" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-14 text-center md:pb-24 md:pt-24">
        {/* Titre en graisse légère, avec un passage en gras italique : la
            signature typographique de MentorGoal. Un trait corail se dessine
            sous la promesse une fois la ligne posée. */}
        <h1 className="mx-auto max-w-4xl font-display text-[44px] font-normal leading-[1.08] tracking-[-0.02em] text-content sm:text-6xl md:text-[78px]">
          <Reveal as="span" delay={80} className="block">
            Trouvez la bonne salle,
          </Reveal>
          <Reveal as="span" delay={180} className="relative inline-block pb-2 font-extrabold italic">
            au bon moment
            <svg
              aria-hidden="true"
              viewBox="0 0 300 20"
              preserveAspectRatio="none"
              className="absolute -bottom-1 left-0 h-4 w-full md:h-5"
            >
              <path
                d="M4 14 C 70 4, 150 4, 296 10"
                pathLength="1"
                fill="none"
                stroke="rgb(var(--corail))"
                strokeWidth="6"
                strokeLinecap="round"
                className="trait-dessine [animation-delay:900ms]"
              />
            </svg>
          </Reveal>
          <Reveal as="span" delay={280} className="block">
            et sans conflit.
          </Reveal>
        </h1>

        <Reveal
          as="p"
          delay={380}
          className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-content-muted md:text-lg"
        >
          Notre algorithme d’analyse croise vos besoins d’équipement, de capacité et les emplois du
          temps pour vous recommander la salle adaptée instantanément, et détecte les conflits
          avant qu’ils n’arrivent.
        </Reveal>

        <Reveal delay={460} className="mt-8 flex flex-wrap justify-center gap-3">
          <Button to="/connexion" size="lg" variant="corail" iconRight={ArrowRight} className="pl-6">
            Démarrer maintenant
          </Button>
          <Button href="#fonctionnalites" variant="secondary" size="lg">
            Découvrir les fonctionnalités
          </Button>
        </Reveal>

        <StatBand stats={stats} isLoading={isLoading} />

        <div className="mt-16 [perspective:1600px] md:mt-20">
          <div
            ref={apercu}
            className="verre mx-auto max-w-4xl rounded-[32px] p-2.5 text-left shadow-haute md:p-3"
            style={{
              transformOrigin: '50% 0%',
              transform:
                'rotateX(calc((1 - var(--redressement, 1)) * 24deg)) scale(calc(0.9 + var(--redressement, 1) * 0.1))',
            }}
          >
            <AppPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
