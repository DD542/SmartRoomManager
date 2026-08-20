import { Clock, Search, Users } from 'lucide-react';
import { Card } from '../ui/Card';
import { StaggerList } from '../ui/StaggerList';

const PROBLEMS = [
  {
    icon: Clock,
    tone: 'text-danger',
    ring: 'border-danger/40 bg-danger-soft',
    title: '30 % des créneaux perdus',
    body: 'Salles réservées mais jamais occupées, à cause de l’absence de confirmation de présence.',
  },
  {
    icon: Users,
    tone: 'text-warning',
    ring: 'border-warning/40 bg-warning-soft',
    title: '1 réunion sur 5 sans salle adaptée',
    body: 'Problèmes d’équipement manquant ou de capacité insuffisante pour le groupe.',
  },
  {
    icon: Search,
    tone: 'text-accent',
    ring: 'border-accent/40 bg-accent-soft',
    title: '15 min perdues par recherche',
    body: 'Temps moyen passé par les collaborateurs pour trouver une salle disponible.',
  },
];

/** P-01 — le problème métier, avant la démonstration de la solution. */
export function LandingProblems() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="mx-auto max-w-md text-center text-2xl font-semibold leading-snug tracking-tight text-content sm:text-3xl">
          La réalité de la gestion d’espace aujourd’hui
        </h2>

        <StaggerList className="mt-10 grid gap-3 md:grid-cols-3">
          {PROBLEMS.map((problem) => (
            <Card key={problem.title} className="h-full p-6 text-center">
              <span
                className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border ${problem.ring}`}
              >
                <problem.icon size={18} aria-hidden="true" className={problem.tone} />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-content">{problem.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">{problem.body}</p>
            </Card>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}
