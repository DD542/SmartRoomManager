import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, DoorOpen, Info, Minus, Plus, Send, ShieldCheck } from 'lucide-react';
import { createAccessRequest, listApprovers } from '../../api/accessRequests';
import { useAsync } from '../../hooks/useAsync';
import { useBooking } from '../../hooks/useBooking';
import { useToast } from '../../hooks/useToast';
import { fmtDateLong } from '../../utils/dates';
import { visitDaysLabel } from '../../utils/openingRules';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, Callout } from '../../components/ui/Card';
import { Checkbox, Field, Select, Textarea } from '../../components/ui/Form';
import { Timeline } from '../../components/ui/Stepper';
import { PageHeader } from '../../components/layout/PageHeader';

/**
 * U-13 — Demande d'accès exceptionnel.
 * Déclenchée quand le créneau tombe hors des jours de visite de la salle :
 * la demande est adressée au gestionnaire de site, qui tranche.
 */
export default function ExceptionalAccessPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { draft, update } = useBooking();
  const [form, setForm] = useState({ reason: '', approverId: '', accepted: false });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    document.title = 'Demande d’accès exceptionnel — SmartRoom Manager';
  }, []);

  const approvers = useAsync(listApprovers, []);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const request = await createAccessRequest({
        roomId: draft.roomId,
        date: draft.date,
        reason: form.reason,
        approverId: form.approverId || approvers.data?.[0]?.id,
        attendees: Number(draft.attendees),
        accepted: form.accepted,
      });
      setSent(request);
      toast.success('Demande envoyée', 'Le gestionnaire de site répond sous 24 h ouvrées.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const steps = (sent?.steps ?? [
    { key: 'envoyee', label: 'Demande envoyée', done: false },
    { key: 'validation', label: 'Validation gestionnaire', done: false },
    { key: 'confirmation', label: 'Confirmation', done: false },
  ]).map((step) => ({
    id: step.key,
    label: step.label,
    tone: step.done ? 'success' : undefined,
    description:
      step.key === 'envoyee'
        ? 'En attente de soumission de ce formulaire.'
        : step.key === 'validation'
          ? 'Examen par le gestionnaire (délai indicatif : 24 h).'
          : 'Génération de l’accès dérogatoire et notification.',
  }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <PageHeader
        title="Demande d’accès exceptionnel"
        subtitle="Justifiez votre demande de réservation hors des jours d’ouverture."
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <Callout tone="warning" icon={AlertTriangle} title="Fermeture habituelle du site">
            {draft.room
              ? `La salle ${draft.room.name} n’est accessible que : ${visitDaysLabel(draft.room.rules.visitDays).toLowerCase()}. Toute réservation en dehors nécessite une validation du gestionnaire.`
              : 'La date sélectionnée correspond à un jour de fermeture habituel du site.'}
          </Callout>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="flex items-center gap-3 p-3.5">
              <DoorOpen size={15} aria-hidden="true" className="text-accent" />
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Salle concernée</p>
                <p className="text-sm text-content">{draft.room?.name ?? 'Non sélectionnée'}</p>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-3.5">
              <CalendarDays size={15} aria-hidden="true" className="text-accent" />
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Date demandée</p>
                <p className="text-sm capitalize text-content">{fmtDateLong(draft.date)}</p>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Motif de la demande" />
            <div className="flex flex-col gap-4 px-4 pb-4">
              <Textarea
                label="Motif"
                required
                rows={4}
                placeholder="Décrivez en détail la raison nécessitant un accès en dehors des jours d’ouverture…"
                value={form.reason}
                onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))}
              />

              <Select
                label="Responsable de validation"
                hint="Ce responsable recevra une notification pour valider votre demande."
                value={form.approverId}
                onChange={(event) => setForm((c) => ({ ...c, approverId: event.target.value }))}
                options={(approvers.data ?? []).map((approver) => ({
                  value: approver.id,
                  label: approver.label,
                }))}
              />

              <Field label="Nombre de participants attendus" htmlFor="participants-attendus">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Retirer un participant"
                    onClick={() => update({ attendees: Math.max(1, Number(draft.attendees) - 1) })}
                  >
                    <Minus size={15} aria-hidden="true" />
                  </Button>
                  <input
                    id="participants-attendus"
                    type="number"
                    min={1}
                    value={draft.attendees}
                    onChange={(event) => update({ attendees: event.target.value })}
                    className="h-10 w-24 rounded-xl border border-line bg-surface-raised px-3 text-center font-mono text-sm text-content focus:border-accent focus:outline-none"
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Ajouter un participant"
                    onClick={() => update({ attendees: Number(draft.attendees) + 1 })}
                  >
                    <Plus size={15} aria-hidden="true" />
                  </Button>
                </div>
              </Field>

              <Checkbox
                label="J’accepte de respecter les consignes de sécurité spécifiques aux accès dérogatoires."
                description="Elles couvrent la fermeture des locaux, l’extinction des équipements et la présence d’un responsable."
                checked={form.accepted}
                onChange={(accepted) => setForm((c) => ({ ...c, accepted }))}
              />

              {error && <Callout tone="danger">{error}</Callout>}
            </div>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-4">
          <CardHeader title="Flux de validation" icon={ShieldCheck} />
          <div className="px-4 pb-4">
            <Timeline items={steps} />
            <Callout tone="info" icon={Info} className="mt-4">
              Les accès dérogatoires sont délivrés à titre exceptionnel : assurez-vous que le motif
              justifie la mobilisation des services généraux (sécurité, nettoyage).
            </Callout>
          </div>
        </Card>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Annuler
        </Button>
        <Button type="submit" icon={Send} loading={pending} disabled={Boolean(sent)}>
          {sent ? 'Demande envoyée' : 'Envoyer la demande'}
        </Button>
      </footer>
    </form>
  );
}
