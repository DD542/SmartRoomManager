import { ArrowRight, Sparkles } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getPublicStats } from '../../api/stats';
import { fmtPercent } from '../../utils/format';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/States';
import { AppPreview } from './AppPreview';

function StatBand({ stats, isLoading }) {
  const items = stats
    ? [
        { value: String(stats.rooms), label: stats.rooms > 1 ? 'salles connectées' : 'salle connectée' },
        { value: String(stats.buildings), label: 'bâtiments couverts' },
        { value: String(stats.doubleBookings), label: 'double réservation' },
        { value: fmtPercent(stats.averageOccupancy), label: "taux d'occupation moyen" },
      ]
    : [];

  if (isLoading) {
    return (
      <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton rounded="rounded" className="h-7 w-12" />
            <Skeleton rounded="rounded" className="h-3 w-24" />
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
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
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-content-muted">
            <Sparkles size={13} aria-hidden="true" className="text-accent" />
            Réservation intelligente des salles
          </p>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
            <span className="block text-content">Trouvez la bonne salle.</span>
            <span className="block text-accent">Au bon moment.</span>
            <span className="block text-content">Sans conflit.</span>
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-relaxed text-content-muted">
            SmartRoom Manager croise vos besoins d’équipement, la capacité demandée et l’emploi du
            temps des espaces pour vous recommander la salle la plus adaptée, puis détecte les
            conflits avant qu’ils n’arrivent.
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
