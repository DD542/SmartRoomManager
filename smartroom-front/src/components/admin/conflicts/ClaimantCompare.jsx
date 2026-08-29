import { CalendarClock, Clock3, History } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Badge } from '../../ui/Badge';
import { Avatar } from '../../ui/Avatar';
import { fmtDate, fmtTime, toDate } from '../../../utils/dates';
import { plural } from '../../../utils/format';

/**
 * A-04 — comparaison des deux demandeurs.
 *
 * L'antériorité est calculée, pas décorative : le badge « Demande la plus
 * ancienne » va à celui dont la demande a réellement été enregistrée en premier,
 * ce qui est le critère d'arbitrage par défaut du règlement.
 */
export function ClaimantCompare({ claimants = [] }) {
  if (claimants.length === 0) return null;

  const plusAncien = [...claimants].sort(
    (a, b) => toDate(a.createdAt) - toDate(b.createdAt),
  )[0];
  const quotaMin = Math.min(...claimants.map((c) => c.remainingQuotaH));

  return (
    <ul className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
      {claimants.map((claimant) => {
        const antérieur = claimant.userId === plusAncien.userId;
        const quotaSerre = claimant.remainingQuotaH === quotaMin && claimants.length > 1;
        return (
          <li
            key={claimant.userId ?? claimant.name}
            className={cn(
              'rounded-xl border p-3',
              antérieur ? 'border-accent/50 bg-accent-soft' : 'border-line bg-surface-raised',
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar name={claimant.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm text-content">{claimant.name}</p>
                <p className="truncate text-[11px] text-content-faint">{claimant.role}</p>
              </div>
            </div>

            <dl className="mt-3 flex flex-col gap-1.5 text-xs">
              <Ligne icon={CalendarClock} label="Créneau demandé">
                {fmtTime(claimant.start)} – {fmtTime(claimant.end)}
              </Ligne>
              <Ligne icon={History} label="Demande déposée">
                {fmtDate(claimant.createdAt)} à {fmtTime(claimant.createdAt)}
              </Ligne>
              <Ligne icon={Clock3} label="Quota restant">
                <span className={quotaSerre ? 'text-warning' : undefined}>
                  {claimant.remainingQuotaH} h
                </span>
              </Ligne>
              <Ligne label="Ce mois-ci">{plural(claimant.monthlyBookings, 'réservation')}</Ligne>
            </dl>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {antérieur && <Badge tone="accent">Demande la plus ancienne</Badge>}
              {quotaSerre && <Badge tone="warning">Quota le plus contraint</Badge>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Ligne({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1.5 text-content-muted">
        {Icon && <Icon size={12} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="font-mono text-content">{children}</dd>
    </div>
  );
}
