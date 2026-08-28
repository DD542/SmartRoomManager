import { KeyRound, MapPin } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';

/**
 * U-05 — rail droit : localisation, itinéraire depuis l'entrée et conditions
 * d'accès de la salle retenue.
 */
export function AccessAside({ room, steps = [] }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Localisation" icon={MapPin} />
        <div className="px-4 pb-4">
          <p className="text-sm text-content">{room?.building?.name}</p>
          <p className="mt-0.5 text-xs text-content-muted">
            {room?.floor} — {room?.building?.campus}
          </p>
          <ol className="mt-3 flex flex-col gap-1.5">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2 text-xs text-content-muted">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised font-mono text-[10px]">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <Card>
        <CardHeader title="Instructions d’accès" icon={KeyRound} />
        <div className="flex flex-col gap-3 px-4 pb-4 text-xs leading-relaxed text-content-muted">
          <p>
            <span className="block text-sm text-content">Code d’accès numérique</span>
            Un code unique vous sera envoyé par e-mail et sera visible sur votre tableau de bord une
            heure avant le début de la réunion.
          </p>
          {room?.badgeRequired && (
            <p>
              <span className="block text-sm text-content">Badge requis</span>
              Cette salle exige un badge d’accès actif en plus du code numérique.
            </p>
          )}
          <p>
            <span className="block text-sm text-content">Accès visiteurs</span>
            Les invités extérieurs se présentent à l’accueil du bâtiment munis d’une pièce d’identité.
          </p>
        </div>
      </Card>
    </div>
  );
}
