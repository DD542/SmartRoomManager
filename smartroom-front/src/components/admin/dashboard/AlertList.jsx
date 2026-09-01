import { AlertTriangle, ArrowRight, Info, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../../utils/cn';
import { Card, CardHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/States';
import { PermissionGate } from '../PermissionGate';

const TONS = {
  warning: { icon: AlertTriangle, classe: 'border-warning/40 bg-warning-soft text-warning' },
  info: { icon: Info, classe: 'border-accent/40 bg-accent-soft text-accent-bright' },
};

/**
 * A-01 — points d'attention du parc.
 *
 * Chaque ligne est dérivée de l'état réel des salles et de la file d'arbitrage,
 * et mène à l'écran qui permet d'agir : une alerte sans issue ne sert à rien.
 */
export function AlertList({ alerts = [], className }) {
  if (alerts.length === 0) {
    return (
      <Card className={className}>
        <CardHeader title="Points d’attention" />
        <div className="px-4 pb-4">
          <EmptyState
            icon={ShieldCheck}
            title="Aucun point d’attention"
            description="Aucune salle en maintenance, aucune sous-utilisation et aucune demande en attente."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader title="Points d’attention" subtitle={`${alerts.length} signalement(s)`} />
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {alerts.map((alerte, index) => {
          const ton = TONS[alerte.tone] ?? TONS.info;
          const Icone = ton.icon;
          return (
            <li
              key={alerte.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5',
                  ton.classe,
                )}
              >
                <Icone size={15} aria-hidden="true" className="shrink-0" />
                <p className="min-w-0 flex-1 text-sm text-content">{alerte.message}</p>
                {alerte.action && (
                  // L'issue proposée n'est affichée qu'aux comptes qui peuvent
                  // vraiment l'emprunter : ailleurs, elle ouvrirait un refus.
                  <PermissionGate permission={alerte.action.permission}>
                    <Link
                      to={alerte.action.to}
                      // 44 px de haut, la cible retenue dans l'espace
                      // utilisateur. Ce lien faisait 16 px — sous le minimum
                      // de 24 px du référentiel d'accessibilité — alors qu'il
                      // porte l'action principale de sa ligne. Le retrait
                      // horizontal garde la densité du tableau de bord : c'est
                      // la hauteur qui manquait au doigt, pas la largeur.
                      //
                      // Relaché à partir de `lg` : la souris vise 16 px sans
                      // peine, et cinq lignes d'alerte allongées de quatorze
                      // pixels chacune étireraient le tableau de bord pour
                      // rien. C'est la même borne que les tableaux qui
                      // deviennent des cartes.
                      className="-mx-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium transition hover:underline lg:mx-0 lg:min-h-0 lg:px-0"
                    >
                      {alerte.action.label}
                      <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                  </PermissionGate>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
