import { AlertTriangle, BarChart3, CalendarDays, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { StaggerList } from '../ui/StaggerList';

const MAIN = {
  icon: SlidersHorizontal,
  title: 'Recherche multicritère avancée',
  body:
    'Filtrez instantanément les salles par capacité, équipement spécifique (projecteur, écran, ' +
    'tableau blanc) et bâtiment. L’algorithme exclut d’office les salles en maintenance et celles ' +
    'qui ne tiennent pas l’effectif demandé.',
};

const CONFLICT = {
  icon: AlertTriangle,
  title: 'Détection de conflits',
  body:
    'Alerte immédiate si une salle est doublement réservée ou si le battement entre deux réunions ' +
    'est insuffisant.',
};

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Recommandation auto',
    body:
      'Proposition de la salle idéale selon un score pondéré, avec la justification affichée sous ' +
      'chaque proposition.',
  },
  {
    icon: CalendarDays,
    title: 'Calendrier partagé',
    body: 'Vue unifiée de l’occupation des bâtiments pour tous les collaborateurs, du jour à l’année.',
  },
  {
    icon: BarChart3,
    title: 'Statistiques',
    body: 'Analysez le taux d’occupation réel et optimisez vos espaces physiques.',
  },
];

/** P-01 — ancre #fonctionnalites, reprise des fonctionnalités imposées par le sujet. */
export function LandingFeatures() {
  return (
    <section id="fonctionnalites" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          Un système complet
        </h2>
        <p className="mt-2 max-w-xl text-sm text-content-muted">
          Conçu pour éliminer la friction dans la réservation d’espaces partagés.
        </p>

        {/* Première rangée : la fonction principale, large, et la détection de conflits. */}
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
              <MAIN.icon size={17} aria-hidden="true" className="text-accent" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-content">{MAIN.title}</h3>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-content-muted">{MAIN.body}</p>
          </Card>

          <Card className="p-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised">
              <CONFLICT.icon size={17} aria-hidden="true" className="text-warning" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-content">{CONFLICT.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-content-muted">{CONFLICT.body}</p>
          </Card>
        </div>

        {/* Seconde rangée : trois fonctions de même niveau. */}
        <StaggerList className="mt-3 grid gap-3 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="h-full p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-raised">
                <feature.icon size={15} aria-hidden="true" className="text-content-muted" />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-content">{feature.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">{feature.body}</p>
            </Card>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}
