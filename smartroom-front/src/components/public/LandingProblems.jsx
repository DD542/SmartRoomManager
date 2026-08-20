import { Clock, Search, Users } from 'lucide-react';
import { Card } from '../ui/Card';
import { StaggerList } from '../ui/StaggerList';

const PROBLEMS = [
  {
    icon: Clock,
    tone: 'text-danger',
    title: '30 % des créneaux perdus',
    body: 'Des salles réservées mais jamais occupées, faute de confirmation de présence.',
  },
  {
    icon: Users,
    tone: 'text-warning',
    title: '1 réunion sur 5 sans salle adaptée',
    body: 'Effectif mal estimé ou équipement manquant : la réunion démarre en retard.',
  },
  {
    icon: Search,
    tone: 'text-accent',
    title: '15 min perdues par recherche',
    body: 'Sans vue consolidée des disponibilités, chacun refait la même recherche.',
  },
];

/** P-01 — le problème métier, avant la démonstration de la solution. */
export function LandingProblems() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="max-w-lg text-2xl font-semibold tracking-tight text-content">
          La réalité de la gestion d’espace aujourd’hui
        </h2>

        <StaggerList className="mt-8 grid gap-3 md:grid-cols-3">
          {PROBLEMS.map((problem) => (
            <Card key={problem.title} className="h-full p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised">
                <problem.icon size={17} aria-hidden="true" className={problem.tone} />
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
