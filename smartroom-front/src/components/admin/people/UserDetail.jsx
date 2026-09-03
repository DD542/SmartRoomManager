import { useState } from 'react';
import { Ban, Check, ShieldCheck, UserMinus } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { EtiquetteExterne } from './EtiquetteExterne';
import { Button } from '../../ui/Button';
import { Input, Textarea } from '../../ui/Form';
import { Modal } from '../../ui/Modal';
import { DetailRow } from '../DetailPanel';
import { fmtDate } from '../../../utils/dates';
import { BOOKING_STATUS_LABEL, fmtPercent, fullName } from '../../../utils/format';

/**
 * A-11 — fiche d'un utilisateur.
 *
 * Les métriques viennent du magasin de réservations : annuler ou créer une
 * réservation les déplace immédiatement, elles ne sont pas figées à la fiche.
 */
export function UserDetail({ user, onStatus, onCredits, onRemove, busy = false }) {
  const [quota, setQuota] = useState(user.preferences?.weeklyQuotaHours ?? 12);
  // Le changement de statut passe par une modale qui recueille le motif :
  // l'API l'exige (trois caractères au moins) parce qu'il constitue la trace
  // au journal d'audit. Le fabriquer côté écran aurait rempli le journal de
  // « Suspension administrative » identiques, sans dire pourquoi.
  const [motif, setMotif] = useState('');
  const [confirme, setConfirme] = useState(false);
  // Le retrait a sa propre saisie : reutiliser celle de la suspension
  // laisserait un motif ecrit pour une decision servir a une autre, bien plus
  // grave, et l'audit garderait la mauvaise phrase.
  const [motifRetrait, setMotifRetrait] = useState('');
  const [retraitConfirme, setRetraitConfirme] = useState(false);
  const retraitCourt = motifRetrait.trim().length < 3;
  const suspendu = user.status === 'suspendu';
  const motifCourt = motif.trim().length < 3;

  const fermer = () => {
    setConfirme(false);
    setMotif('');
  };

  return (
    <>
      <DetailRow label="Adresse email">
        <span className="flex flex-col items-end gap-1">
          {user.email}
          {user.isExternal && <EtiquetteExterne email={user.email} />}
        </span>
      </DetailRow>
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
          onClick={() => setConfirme(true)}
        >
          {suspendu ? 'Réactiver le compte' : 'Suspendre le compte'}
        </Button>

        {onRemove && (
          <>
            <p className="mb-2 mt-3 text-xs text-content-muted">
              Le retrait efface l’identité du compte et libère ses créneaux à
              venir. Son historique reste, sans nom. C’est définitif.
            </p>
            <Button
              variant="danger"
              size="sm"
              icon={UserMinus}
              loading={busy}
              onClick={() => setRetraitConfirme(true)}
            >
              Retirer le compte
            </Button>
          </>
        )}
      </div>

      <Modal
        open={confirme}
        onClose={fermer}
        icon={suspendu ? ShieldCheck : Ban}
        tone={suspendu ? 'default' : 'danger'}
        size="sm"
        title={suspendu ? 'Réactiver le compte' : 'Suspendre le compte'}
        description={
          suspendu
            ? `${fullName(user)} pourra de nouveau réserver dès la réactivation.`
            : `${fullName(user)} ne pourra plus réserver et ses sessions ouvertes seront fermées. Les réservations déjà confirmées sont conservées.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={fermer} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant={suspendu ? 'success' : 'danger'}
              icon={suspendu ? ShieldCheck : Ban}
              loading={busy}
              disabled={motifCourt}
              onClick={() => {
                onStatus(suspendu ? 'actif' : 'suspendu', motif.trim());
                fermer();
              }}
            >
              {suspendu ? 'Réactiver' : 'Suspendre'}
            </Button>
          </>
        }
      >
        <Textarea
          label="Motif de la décision"
          rows={3}
          value={motif}
          onChange={(event) => setMotif(event.target.value)}
          placeholder={
            suspendu
              ? 'Régularisation après entretien du 24 août.'
              : 'Trois absences non excusées en deux semaines.'
          }
          hint="Obligatoire : il est consigné au journal d’audit et notifié au compte."
        />
      </Modal>

      <Modal
        open={retraitConfirme}
        onClose={() => {
          setRetraitConfirme(false);
          setMotifRetrait('');
        }}
        icon={UserMinus}
        tone="danger"
        size="sm"
        title="Retirer le compte"
        description={`${fullName(user)} ne pourra plus se connecter, son identité sera effacée et ses réservations à venir annulées. Son historique restera au parc, sans nom. Cette décision ne se défait pas.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRetraitConfirme(false);
                setMotifRetrait('');
              }}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              icon={UserMinus}
              loading={busy}
              disabled={retraitCourt}
              onClick={() => {
                onRemove(motifRetrait.trim());
                setRetraitConfirme(false);
                setMotifRetrait('');
              }}
            >
              Retirer définitivement
            </Button>
          </>
        }
      >
        <Textarea
          label="Motif du retrait"
          rows={3}
          value={motifRetrait}
          onChange={(event) => setMotifRetrait(event.target.value)}
          placeholder="Départ de l’établissement, demande du service scolarité."
          hint="Obligatoire : c’est ce que le journal d’audit conservera de la décision, une fois le nom parti."
        />
      </Modal>
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
