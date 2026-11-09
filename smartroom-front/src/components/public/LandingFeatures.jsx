import { AlertTriangle, BarChart3, CalendarDays, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { Reveal } from './Reveal';
import { teinteDuRang } from '../ui/teintes';

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
    <section id="fonctionnalites" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal as="h2" className="font-display text-3xl font-semibold tracking-[-0.03em] text-content sm:text-5xl">
          Un système complet
        </Reveal>
        <Reveal as="p" delay={80} className="mt-4 max-w-2xl text-base leading-relaxed text-content-muted md:text-lg">
          Conçu pour éliminer la friction dans la réservation d’espaces partagés.
        </Reveal>

        {/* Première rangée : la fonction principale, large, et la détection de conflits. */}
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <Card className="group h-full rounded-3xl p-7 transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-aurore-bleu to-aurore-violet text-white shadow-[0_10px_24px_-10px_rgb(var(--violet)/0.8)]">
              <MAIN.icon size={18} aria-hidden="true" />
            </span>
            <h3 className="mt-4 font-display text-2xl font-semibold tracking-tight text-content">{MAIN.title}</h3>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-content-muted">{MAIN.body}</p>
            </Card>
          </Reveal>

          <Reveal delay={120}>
            <Card className="group h-full rounded-3xl p-7 transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-content/[0.06] transition-transform duration-300 group-hover:scale-110">
              <CONFLICT.icon size={17} aria-hidden="true" className="text-warning" />
            </span>
              <h3 className="mt-4 text-base font-semibold tracking-tight text-content">{CONFLICT.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">{CONFLICT.body}</p>
            </Card>
          </Reveal>
        </div>

        {/* Seconde rangée : trois fonctions de même niveau. */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 90} className="h-full">
              <Card className="group h-full rounded-3xl p-6 transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-500 ease-ressort group-hover:scale-110 ${teinteDuRang(index + 2).pastille}`}
                >
                  <feature.icon size={17} aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-base font-semibold tracking-tight text-content">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-content-muted">{feature.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
