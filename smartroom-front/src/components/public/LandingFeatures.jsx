import { AlertTriangle, BarChart3, CalendarDays, SlidersHorizontal, Sparkles } from 'lucide-react';
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

/**
 * Couleurs des cartes, à la manière des blocs de MentorGoal. Fixées et non
 * tirées du thème : ce sont des surfaces de marque, qui gardent leur couleur
 * et leur contraste en clair comme en sombre.
 */
const TEINTES = [
  { fond: 'bg-[#F8F4F1]', pastille: 'bg-[#263171] text-white' },
  { fond: 'bg-[#E3E8FF]', pastille: 'bg-[#FF8053] text-[#0C1547]' },
  { fond: 'bg-[#FCE7DD]', pastille: 'bg-[#CC3366] text-white' },
];

/** Ruban décoratif qui se dessine à l'entrée de la carte dans la fenêtre. */
function Ruban({ className }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 300"
      fill="none"
      className={`ruban pointer-events-none absolute ${className}`}
    >
      <path
        d="M-20 240 C 60 120, 160 300, 220 170 S 340 20, 420 90"
        pathLength="1"
        stroke="currentColor"
        strokeWidth="38"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** P-01 — ancre #fonctionnalites, reprise des fonctionnalités imposées par le sujet. */
export function LandingFeatures() {
  return (
    <section id="fonctionnalites" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal as="h2" className="font-display text-3xl font-normal tracking-[-0.02em] text-content sm:text-5xl">
          Un système <span className="font-extrabold italic">complet</span>
        </Reveal>
        <Reveal as="p" delay={80} className="mt-4 max-w-2xl text-base leading-relaxed text-content-muted md:text-lg">
          Conçu pour éliminer la friction dans la réservation d’espaces partagés.
        </Reveal>

        {/* Première rangée : la fonction principale sur fond marine, la
            détection de conflits sur fond corail. */}
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <div className="group relative h-full overflow-hidden rounded-[28px] bg-[#263171] p-8 text-white shadow-carte transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute md:p-10">
              <Ruban className="-right-16 -top-10 h-72 w-[26rem] text-white/[0.07]" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[#FF8053] text-[#0C1547] transition-transform duration-500 ease-ressort group-hover:rotate-[-8deg] group-hover:scale-110">
                <MAIN.icon size={20} aria-hidden="true" />
              </span>
              <h3 className="relative mt-5 font-display text-2xl font-normal tracking-tight md:text-[32px] md:leading-tight">
                Recherche <span className="font-extrabold italic">multicritère</span> avancée
              </h3>
              <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-white/80 md:text-base">{MAIN.body}</p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="group relative h-full overflow-hidden rounded-[28px] bg-[#FF8053] p-8 text-[#0C1547] shadow-carte transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
              <Ruban className="-bottom-16 -left-20 h-64 w-[22rem] text-white/25" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#E8613A] transition-transform duration-500 ease-ressort group-hover:scale-110">
                <CONFLICT.icon size={19} aria-hidden="true" />
              </span>
              <h3 className="relative mt-5 font-display text-xl font-extrabold italic tracking-tight">{CONFLICT.title}</h3>
              <p className="relative mt-2 text-sm font-medium leading-relaxed text-[#0C1547]/85">{CONFLICT.body}</p>
            </div>
          </Reveal>
        </div>

        {/* Seconde rangée : trois fonctions, sur crème, lavande et pêche. */}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 90} className="h-full">
              <div
                className={`group relative h-full overflow-hidden rounded-[28px] p-7 text-[#0C1547] shadow-carte transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute ${TEINTES[index].fond}`}
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-500 ease-ressort group-hover:scale-110 ${TEINTES[index].pastille}`}
                >
                  <feature.icon size={17} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold tracking-tight">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#263171]/85">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
