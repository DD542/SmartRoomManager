import { durationMin, fmtTime, toDate } from '../../../utils/dates';

const PALETTE = ['#5B9BFF', '#FCC63F'];

/**
 * A-04 — chevauchement des deux demandes, à l'échelle du temps.
 *
 * Les barres sont positionnées sur une échelle commune calculée à partir des
 * créneaux réels : la zone rouge correspond exactement aux minutes disputées,
 * elle n'est pas dessinée « à peu près » au centre.
 */
export function OverlapTimeline({ claimants = [], roomName }) {
  if (claimants.length < 2) return null;

  const debuts = claimants.map((c) => toDate(c.start).getTime());
  const fins = claimants.map((c) => toDate(c.end).getTime());
  const min = Math.min(...debuts);
  const max = Math.max(...fins);
  const amplitude = Math.max(1, max - min);

  const pourcent = (valeur) => ((valeur - min) / amplitude) * 100;

  // Intersection des deux créneaux : bornes réelles, pas une approximation.
  const debutChevauchement = Math.max(...debuts);
  const finChevauchement = Math.min(...fins);
  const chevauche = finChevauchement > debutChevauchement;
  const minutes = chevauche
    ? durationMin(new Date(debutChevauchement), new Date(finChevauchement))
    : 0;

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <p className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-content-muted">
          Chevauchement — {roomName}
        </span>
        <span className="font-mono text-xs text-danger">
          {chevauche ? `${minutes} min disputées` : 'Créneaux jointifs'}
        </span>
      </p>

      <div className="relative">
        {chevauche && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-md border border-danger/50 bg-danger/15"
            style={{
              left: `${pourcent(debutChevauchement)}%`,
              width: `${pourcent(finChevauchement) - pourcent(debutChevauchement)}%`,
            }}
          />
        )}

        <ul className="relative flex flex-col gap-2">
          {claimants.map((claimant, index) => (
            <li key={claimant.userId ?? index} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-content-muted">
                {claimant.name}
              </span>
              <span className="relative h-6 flex-1">
                <span
                  className="absolute inset-y-0 flex items-center justify-center rounded-md border px-2 text-[10px] text-content"
                  style={{
                    left: `${pourcent(toDate(claimant.start).getTime())}%`,
                    width: `${pourcent(toDate(claimant.end).getTime()) - pourcent(toDate(claimant.start).getTime())}%`,
                    background: `${PALETTE[index % PALETTE.length]}2E`,
                    borderColor: PALETTE[index % PALETTE.length],
                  }}
                >
                  {fmtTime(claimant.start)} – {fmtTime(claimant.end)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 flex justify-between font-mono text-[10px] text-content-faint">
        <span>{fmtTime(new Date(min))}</span>
        <span>{fmtTime(new Date(max))}</span>
      </p>
    </div>
  );
}
