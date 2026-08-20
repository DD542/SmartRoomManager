import { AlertTriangle, BarChart3, CalendarDays, KeyRound, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { StaggerList } from '../ui/StaggerList';

const MAIN = {
  icon: SlidersHorizontal,
  title: 'Recherche multicritère avancée',
  body:
    'Filtrez sur la capacité, les équipements, le bâtiment, l’étage et l’accessibilité PMR. Les salles en maintenance sont écartées, celles qui ne tiennent que tout juste l’effectif restent visibles mais signalées.',
};

const FEATURES = [
  {
    icon: AlertTriangle,
    title: 'Détection de conflits',
    body:
      'Chevauchement total, partiel ou battement trop court entre deux réunions : chaque cas est qualifié et expliqué.',
  },
  {
    icon: Sparkles,
    title: 'Recommandation automatique',
    body:
      'Un score pondère la capacité, les équipements, le bâtiment habituel et le taux d’occupation, avec la justification affichée.',
  },
  {
    icon: CalendarDays,
    title: 'Calendrier partagé',
    body: 'Vue semaine et vue mois, jours de fermeture matérialisés, créneaux récurrents en un clic.',
  },
  {
    icon: KeyRound,
    title: 'Codes d’accès',
    body: 'Un code régénéré à chaque changement de salle ou d’horaire, envoyé par e-mail et validé sur place.',
  },
  {
    icon: BarChart3,
    title: 'Statistiques d’occupation',
    body: 'Heures réservées, répartition par salle, créneaux préférés et taux de présence réel.',
  },
];

/** P-01 — ancre #fonctionnalites, reprise des fonctionnalités imposées par le sujet. */
export function LandingFeatures() {
  return (
    <section id="fonctionnalites" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-content">Un système complet</h2>
        <p className="mt-2 max-w-xl text-sm text-content-muted">
          Conçu pour éliminer la friction dans la réservation d’espaces partagés.
        </p>

        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          <Card className="flex flex-col justify-between p-6 lg:row-span-2">
            <div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
                <MAIN.icon size={17} aria-hidden="true" className="text-accent" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-content">{MAIN.title}</h3>
              <p className="mt-3 text-xs leading-relaxed text-content-muted">{MAIN.body}</p>
            </div>
          </Card>

          <StaggerList className="contents">
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
      </div>
    </section>
  );
}
