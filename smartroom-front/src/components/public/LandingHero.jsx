import { ArrowRight, Zap } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getPublicStats } from '../../api/stats';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/States';
import { AppPreview } from './AppPreview';

function StatBand({ stats, isLoading }) {
  // Les valeurs viennent du catalogue réel ; seuls les libellés sont ceux de la maquette.
  const items = stats
    ? [
        { value: String(stats.rooms), label: 'Salles connectées' },
        { value: String(stats.buildings), label: 'Bâtiments équipés' },
        { value: String(stats.doubleBookings), label: 'Double réservation' },
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
    <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-line pt-6">
      {items.map((item) => (
        // flex-col-reverse : la valeur s'affiche au-dessus, l'ordre du DOM reste terme puis définition.
        <div key={item.label} className="flex flex-col-reverse gap-1">
          <dt className="text-xs text-content-muted">{item.label}</dt>
          <dd className="font-mono text-2xl text-content">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** P-01 — bandeau d'ouverture : promesse, actions, aperçu de l'application. */
export function LandingHero() {
  const { data: stats, isLoading } = useAsync(getPublicStats, []);

  return (
    <section className="border-b border-line">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.05fr_1fr] md:items-center md:py-20">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-content-muted">
            <Zap size={12} aria-hidden="true" className="text-accent" />
            Réservation intelligente de salles
          </p>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
            <span className="block text-content">Trouvez la bonne salle.</span>
            <span className="block text-accent">Au bon moment.</span>
            <span className="block text-content">Sans conflit.</span>
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-relaxed text-content-muted">
            Notre algorithme d’analyse croise vos besoins d’équipement, de capacité et les emplois du
            temps pour vous recommander la salle adaptée instantanément, et détecte les conflits
            avant qu’ils n’arrivent.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button to="/connexion" size="lg" iconRight={ArrowRight}>
              Se connecter
            </Button>
            <Button href="#fonctionnalites" variant="secondary" size="lg">
              Découvrir les fonctionnalités
            </Button>
          </div>

          <StatBand stats={stats} isLoading={isLoading} />
        </div>

        <AppPreview />
      </div>
    </section>
  );
}
