import { useEffect, useState } from 'react';
import { ArrowRight, Zap } from 'lucide-react';
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
    <dd ref={cible} className="font-mono text-2xl text-content">
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
      <dl className="mt-10 grid grid-cols-3 gap-6">
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
    <dl className="mt-10 grid grid-cols-3 gap-6">
      {items.map((item) => (
        // flex-col-reverse : la valeur s'affiche au-dessus, l'ordre du DOM reste terme puis définition.
        <div key={item.label} className="flex flex-col-reverse gap-1">
          <dt className="text-xs text-content-muted">{item.label}</dt>
          <Compteur valeur={item.value} />
        </div>
      ))}
    </dl>
  );
}

/** P-01 — bandeau d'ouverture : promesse, actions, aperçu de l'application. */
export function LandingHero() {
  const { data: stats, isLoading } = useAsync(getPublicStats, []);

  return (
    <section>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.05fr_1fr] md:items-center md:py-20">
        <div>
          <Reveal
            as="p"
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-content-muted"
          >
            <Zap size={12} aria-hidden="true" className="text-accent" />
            Réservation intelligente de salles
          </Reveal>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
            <Reveal as="span" delay={80} className="block text-content">
              Trouvez la bonne salle.
            </Reveal>
            <Reveal as="span" delay={180} className="block text-accent">
              Au bon moment.
            </Reveal>
            <Reveal as="span" delay={280} className="block text-content">
              Sans conflit.
            </Reveal>
          </h1>

          <Reveal as="p" delay={380} className="mt-5 max-w-lg text-sm leading-relaxed text-content-muted">
            Notre algorithme d’analyse croise vos besoins d’équipement, de capacité et les emplois du
            temps pour vous recommander la salle adaptée instantanément, et détecte les conflits
            avant qu’ils n’arrivent.
          </Reveal>

          <Reveal delay={460} className="mt-7 flex flex-wrap gap-3">
            <Button to="/connexion" size="lg" iconRight={ArrowRight}>
              Se connecter
            </Button>
            <Button href="#fonctionnalites" variant="secondary" size="lg">
              Découvrir les fonctionnalités
            </Button>
          </Reveal>

          <StatBand stats={stats} isLoading={isLoading} />
        </div>

        <Reveal delay={220}>
          <AppPreview />
        </Reveal>
      </div>
    </section>
  );
}
