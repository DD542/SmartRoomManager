import { CalendarX2, MapPin, Users } from 'lucide-react';
import { Button } from '../../ui/Button';
import { AccessCode } from '../../ui/AccessCode';
import { DetailRow } from '../DetailPanel';
import { PermissionGate } from '../PermissionGate';
import { AttendanceBadge, SourceBadge } from './SourceBadge';
import {
  NOW,
  durationMin,
  fmtDate,
  fmtDateLong,
  fmtDuration,
  fmtTime,
  toDate,
} from '../../../utils/dates';
import { BOOKING_STATUS_LABEL, fullName, plural } from '../../../utils/format';

/**
 * A-03 — détail de la réservation sélectionnée.
 *
 * L'annulation n'est proposée que si elle a un sens : une réservation passée ou
 * déjà annulée ne l'affiche pas, plutôt que de laisser l'API refuser après coup.
 */
export function BookingDetail({ booking, onCancel }) {
  const annulable = booking.status !== 'annulee' && toDate(booking.end) >= NOW;

  return (
    <>
      <DetailRow label="Créneau">
        <span className="capitalize">{fmtDateLong(booking.start)}</span>
        <br />
        <span className="font-mono text-xs text-content-muted">
          {fmtTime(booking.start)} – {fmtTime(booking.end)} ·{' '}
          {fmtDuration(durationMin(booking.start, booking.end))}
        </span>
      </DetailRow>

      <DetailRow label="Salle">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} aria-hidden="true" className="text-content-muted" />
          {booking.room?.name ?? '—'}
        </span>
        <br />
        <span className="text-xs text-content-muted">{booking.building?.name ?? ''}</span>
      </DetailRow>

      <DetailRow label="Organisateur">
        {booking.owner ? fullName(booking.owner) : 'Aucun (blocage administratif)'}
      </DetailRow>

      <DetailRow label="Participants">
        <span className="inline-flex items-center gap-1.5">
          <Users size={13} aria-hidden="true" className="text-content-muted" />
          {plural(booking.attendees, 'personne')}
        </span>
      </DetailRow>

      <DetailRow label="Source">
        <SourceBadge source={booking.source} />
      </DetailRow>

      <DetailRow label="Statut">
        {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
        {booking.forced && (
          <span className="block text-xs text-warning">Créée en forçant les règles</span>
        )}
      </DetailRow>

      <DetailRow label="Présence">
        <AttendanceBadge attendance={booking.attendance} />
      </DetailRow>

      {booking.accessCode && (
        <DetailRow label="Code d’accès">
          <AccessCode code={booking.accessCode} masked size="sm" />
        </DetailRow>
      )}

      {booking.cancelReason && (
        <DetailRow label="Motif d’annulation">{booking.cancelReason}</DetailRow>
      )}

      <Historique entries={booking.history ?? []} />

      {annulable && (
        <PermissionGate permission="conflicts.arbitrate" mode="desactiver">
          <Button variant="danger" size="sm" icon={CalendarX2} onClick={() => onCancel(booking)}>
            Annuler la réservation
          </Button>
        </PermissionGate>
      )}
    </>
  );
}

function Historique({ entries }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">Historique</p>
      <ol className="flex flex-col gap-2 border-l border-line pl-3">
        {entries.map((entry, index) => (
          <li key={`${entry.type}-${index}`} className="relative text-xs text-content-muted">
            <span
              aria-hidden="true"
              className="absolute -left-[17px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong"
            />
            <span className="text-content">{entry.label}</span>
            <span className="ml-1.5 font-mono text-[11px] text-content-faint">
              {fmtDate(entry.at)} à {fmtTime(entry.at)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
