import { Clock, Search, Users } from 'lucide-react';
import { Card } from '../ui/Card';
import { Reveal } from './Reveal';

const PROBLEMS = [
  {
    icon: Clock,
    tone: 'text-danger',
    ring: 'border-transparent bg-danger-soft',
    title: '30 % des créneaux perdus',
    body: 'Salles réservées mais jamais occupées, à cause de l’absence de confirmation de présence.',
  },
  {
    icon: Users,
    tone: 'text-warning',
    ring: 'border-transparent bg-warning-soft',
    title: '1 réunion sur 5 sans salle adaptée',
    body: 'Problèmes d’équipement manquant ou de capacité insuffisante pour le groupe.',
  },
  {
    icon: Search,
    tone: 'text-[#E8613A]',
    ring: 'border-transparent bg-corail/15',
    title: '15 min perdues par recherche',
    body: 'Temps moyen passé par les collaborateurs pour trouver une salle disponible.',
  },
];

/** P-01 — le problème métier, avant la démonstration de la solution. */
export function LandingProblems() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal as="h2" className="mx-auto max-w-md text-center font-display text-3xl font-normal leading-tight tracking-[-0.02em] text-content sm:text-5xl">
          La réalité de la gestion d’espace <span className="font-extrabold italic">aujourd’hui</span>
        </Reveal>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {PROBLEMS.map((problem, index) => (
            <Reveal key={problem.title} delay={index * 90} className="h-full">
              <Card className="group h-full p-6 text-center transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
                <span
                  className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border transition-transform duration-300 group-hover:scale-110 ${problem.ring}`}
                >
                  <problem.icon size={18} aria-hidden="true" className={problem.tone} />
                </span>
                <h3 className="mt-4 text-base font-semibold tracking-tight text-content">{problem.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-content-muted">{problem.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
