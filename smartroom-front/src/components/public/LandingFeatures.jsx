import { AlertTriangle, BarChart3, CalendarDays, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { Reveal } from './Reveal';

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
    <section id="fonctionnalites" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <Reveal as="h2" className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          Un système complet
        </Reveal>
        <Reveal as="p" delay={80} className="mt-2 max-w-xl text-sm text-content-muted">
          Conçu pour éliminer la friction dans la réservation d’espaces partagés.
        </Reveal>

        {/* Première rangée : la fonction principale, large, et la détection de conflits. */}
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <Card className="group h-full p-6 transition duration-300 hover:-translate-y-1 hover:border-line-strong">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
              <MAIN.icon size={17} aria-hidden="true" className="text-accent" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-content">{MAIN.title}</h3>
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-content-muted">{MAIN.body}</p>
            </Card>
          </Reveal>

          <Reveal delay={120}>
            <Card className="group h-full p-6 transition duration-300 hover:-translate-y-1 hover:border-line-strong">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised transition-transform duration-300 group-hover:scale-110">
              <CONFLICT.icon size={17} aria-hidden="true" className="text-warning" />
            </span>
              <h3 className="mt-4 text-sm font-semibold text-content">{CONFLICT.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">{CONFLICT.body}</p>
            </Card>
          </Reveal>
        </div>

        {/* Seconde rangée : trois fonctions de même niveau. */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 90} className="h-full">
              <Card className="group h-full p-5 transition duration-300 hover:-translate-y-1 hover:border-line-strong">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-raised transition-transform duration-300 group-hover:scale-110">
                  <feature.icon size={15} aria-hidden="true" className="text-content-muted transition-colors duration-300 group-hover:text-accent" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-content">{feature.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-content-muted">{feature.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
