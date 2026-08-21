import { useState } from 'react';
import { Ban, Check, ShieldCheck } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Form';
import { DetailRow } from '../DetailPanel';
import { fmtDate } from '../../../utils/dates';
import { BOOKING_STATUS_LABEL, fmtPercent } from '../../../utils/format';

/**
 * A-11 — fiche d'un utilisateur.
 *
 * Les métriques viennent du magasin de réservations : annuler ou créer une
 * réservation les déplace immédiatement, elles ne sont pas figées à la fiche.
 */
export function UserDetail({ user, onStatus, onCredits, busy = false }) {
  const [quota, setQuota] = useState(user.preferences?.weeklyQuotaHours ?? 12);
  const suspendu = user.status === 'suspendu';

  return (
    <>
      <DetailRow label="Adresse email">{user.email}</DetailRow>
      <DetailRow label="Promotion">{user.promotion}</DetailRow>
      <DetailRow label="Département">{user.department}</DetailRow>
      <DetailRow label="Badge" mono>
        {user.badgeNumber}
      </DetailRow>

      <DetailRow label="Fiabilité">
        {user.metrics.reliabilityScore === null ? (
          <span className="text-content-faint">Aucun historique</span>
        ) : (
          <Badge tone={user.metrics.reliabilityScore >= 80 ? 'success' : 'warning'}>
            {user.metrics.reliabilityScore}/100
          </Badge>
        )}
      </DetailRow>
      <DetailRow label="Taux de présence">{fmtPercent(user.metrics.attendanceRate)}</DetailRow>
      <DetailRow label="Taux de no-show">
        <span className={user.metrics.noShowRate >= 0.2 ? 'text-danger' : undefined}>
          {fmtPercent(user.metrics.noShowRate)}
        </span>
      </DetailRow>
      <DetailRow label="Heures réservées">{user.metrics.bookedHours} h</DetailRow>
      <DetailRow label="Annulations">{user.metrics.cancellations}</DetailRow>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
          Quota hebdomadaire
        </p>
        <div className="flex items-end gap-2">
          <Input
            type="number"
            min={0}
            label="Heures par semaine"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
            className="w-28"
          />
          <Button
            variant="secondary"
            icon={Check}
            disabled={busy || Number(quota) === (user.preferences?.weeklyQuotaHours ?? 12)}
            onClick={() => onCredits(Number(quota))}
          >
            Appliquer
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-content-faint">
          Crédits restants sur la semaine : {user.metrics.remainingCreditsH} h.
        </p>
      </div>

      <Historique bookings={user.recentBookings ?? []} />

      <div className="rounded-xl border border-danger/40 bg-danger-soft p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-danger">Zone de danger</p>
        <p className="mb-2.5 text-xs text-content-muted">
          {suspendu
            ? 'Le compte est suspendu : l’utilisateur ne peut plus réserver, ses réservations à venir sont conservées.'
            : 'La suspension empêche toute nouvelle réservation. Les réservations déjà confirmées ne sont pas annulées.'}
        </p>
        <Button
          variant={suspendu ? 'success' : 'danger'}
          size="sm"
          icon={suspendu ? ShieldCheck : Ban}
          loading={busy}
          onClick={() => onStatus(suspendu ? 'actif' : 'suspendu')}
        >
          {suspendu ? 'Réactiver le compte' : 'Suspendre le compte'}
        </Button>
      </div>
    </>
  );
}

function Historique({ bookings }) {
  if (bookings.length === 0) {
    return <p className="text-xs text-content-faint">Aucune réservation à l’historique.</p>;
  }

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
        Dernières réservations
      </p>
      <ul className="flex flex-col gap-1.5">
        {bookings.map((booking) => (
          <li
            key={booking.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate text-content">{booking.roomName}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-content-faint">
                {fmtDate(booking.start)}
              </span>
              <Badge tone={booking.status === 'annulee' ? 'danger' : 'default'}>
                {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
