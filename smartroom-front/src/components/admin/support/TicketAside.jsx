import { CalendarDays, CircleCheck, Loader, Mail, Phone, RotateCcw } from 'lucide-react';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { DetailRow } from '../DetailPanel';
import { fmtDate, fmtTime } from '../../../utils/dates';
import { BOOKING_STATUS_LABEL } from '../../../utils/format';

const ETATS = [
  { value: 'ouvert', label: 'Rouvrir', icon: RotateCcw },
  { value: 'en_cours', label: 'En cours', icon: Loader },
  { value: 'resolu', label: 'Résolu', icon: CircleCheck },
];

/**
 * A-13 — rail droit : le demandeur et la réservation à l'origine du ticket.
 *
 * Le lien vers la réservation évite au support de la rechercher à la main dans
 * la liste des réservations, seul moyen d'agir dessus sans quitter le contexte.
 */
export function TicketAside({ ticket, onStatus, busy = false }) {
  const demandeur = ticket.requester;
  const liee = ticket.linkedBooking;

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card>
        <CardHeader title="Demandeur" />
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-2.5">
            <Avatar name={demandeur?.name ?? ''} />
            <div className="min-w-0">
              <p className="truncate text-sm text-content">{demandeur?.name}</p>
              <p className="truncate text-[11px] text-content-faint">{demandeur?.promotion}</p>
            </div>
          </div>

          <DetailRow label="Email">
            <span className="inline-flex items-center gap-1.5">
              <Mail size={12} aria-hidden="true" className="text-content-muted" />
              {demandeur?.email}
            </span>
          </DetailRow>
          <DetailRow label="Téléphone">
            <span className="inline-flex items-center gap-1.5">
              <Phone size={12} aria-hidden="true" className="text-content-muted" />
              {demandeur?.phone}
            </span>
          </DetailRow>

          <Button variant="secondary" size="sm" to={`/admin/utilisateurs`}>
            Ouvrir la fiche utilisateur
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Réservation liée" icon={CalendarDays} />
        <div className="px-4 pb-4">
          {liee ? (
            <div className="flex flex-col gap-3">
              <DetailRow label="Salle">{liee.room?.name}</DetailRow>
              <DetailRow label="Créneau" mono>
                {fmtDate(liee.start)} · {fmtTime(liee.start)} – {fmtTime(liee.end)}
              </DetailRow>
              <DetailRow label="Statut">
                <Badge tone={liee.status === 'annulee' ? 'danger' : 'success'} dot>
                  {BOOKING_STATUS_LABEL[liee.status] ?? liee.status}
                </Badge>
              </DetailRow>
              <Button variant="secondary" size="sm" to="/admin/reservations">
                Ouvrir dans les réservations
              </Button>
            </div>
          ) : (
            <p className="text-xs text-content-muted">
              Aucune réservation rattachée à ce ticket.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Actions rapides" />
        <div className="flex flex-wrap gap-1.5 px-4 pb-4">
          {ETATS.filter((etat) => etat.value !== ticket.status).map((etat) => (
            <Button
              key={etat.value}
              variant="secondary"
              size="sm"
              icon={etat.icon}
              disabled={busy}
              onClick={() => onStatus(etat.value)}
            >
              {etat.label}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
