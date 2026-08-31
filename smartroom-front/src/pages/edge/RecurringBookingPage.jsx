import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { createSeries, previewSeries } from '../../api/bookings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useBooking } from '../../hooks/useBooking';
import { useToast } from '../../hooks/useToast';
import { addDays, toDate, toDateInput } from '../../utils/dates';
import { describeRule } from '../../utils/recurrence';
import { fmtCapacity } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Card, Callout } from '../../components/ui/Card';
import { PageHeader } from '../../components/layout/PageHeader';
import { RecurrenceRuleForm } from '../../components/bookings/RecurrenceRuleForm';
import { RecurrencePreview } from '../../components/bookings/RecurrencePreview';

/** U-14 — Réservation récurrente : règle, aperçu des occurrences, création en lot. */
export default function RecurringBookingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { draft, hasDraft, hasRoom } = useBooking();
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState(() => ({
    frequency: 'hebdomadaire',
    weekDays: [toDate(draft.date).getDay()],
    end: { type: 'until', value: toDateInput(addDays(toDate(draft.date), 90)) },
  }));

  useEffect(() => {
    document.title = 'Réservation récurrente — SmartRoom Manager';
  }, []);

  const preview = useAsync(
    () =>
      draft.roomId
        ? previewSeries({
            roomId: draft.roomId,
            date: draft.date,
            startTime: draft.startTime,
            endTime: draft.endTime,
            rule,
          })
        : Promise.resolve([]),
    [draft.roomId, draft.date, draft.startTime, draft.endTime, rule],
  );

  const occurrences = preview.data ?? [];
  const available = useMemo(() => occurrences.filter((item) => item.available), [occurrences]);

  if (!hasDraft || !hasRoom) return <Navigate to="/app/reservation/besoin" replace />;

  const create = async () => {
    setSaving(true);
    try {
      const result = await createSeries({
        roomId: draft.roomId,
        ownerId: user.id,
        title: draft.title || 'Réunion récurrente',
        attendees: Number(draft.attendees),
        requiredEquipmentIds: draft.equipmentIds,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        rule,
      });
      toast.success(
        `${result.created.length} réservations créées`,
        result.skipped.length > 0
          ? `${result.skipped.length} occurrences ignorées pour conflit.`
          : undefined,
      );
      navigate('/app/reservations');
    } catch (error) {
      toast.error('Création impossible', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Réservation récurrente"
        subtitle={describeRule(rule, occurrences)}
      />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <RecurrenceRuleForm
            rule={rule}
            anchorDate={draft.date}
            onChange={(patch) => setRule((current) => ({ ...current, ...patch }))}
          />

          <Card className="flex items-center gap-3 p-3.5">
            <img src={draft.room?.photos?.[0]} alt="" className="h-12 w-16 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-content">{draft.room?.name}</p>
              <p className="text-xs text-content-muted">
                {fmtCapacity(draft.room?.capacity ?? 0)} • {draft.room?.building?.name}
              </p>
            </div>
            <p className="shrink-0 rounded-lg border border-line bg-surface-raised px-2 py-1 font-mono text-xs">
              {draft.startTime} - {draft.endTime}
            </p>
          </Card>
        </div>

        <RecurrencePreview
          occurrences={occurrences}
          isLoading={preview.isLoading}
          onResolve={() => navigate('/app/reservation/conflit')}
        />
      </div>

      {occurrences.length === 0 && !preview.isLoading && (
        <Callout tone="warning">
          Cette règle ne génère aucune date : vérifiez les jours sélectionnés et la date de fin.
        </Callout>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button variant="secondary" icon={ArrowLeft} to={`/app/reservation/salles/${draft.roomId}`}>
          Précédent
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-xs text-content-muted">
            Résumé : <span className="font-mono text-content">{occurrences.length}</span> générées,{' '}
            <span className="font-mono text-danger">{occurrences.length - available.length}</span>{' '}
            conflits
          </p>
          <Button icon={CalendarPlus} loading={saving} disabled={available.length === 0} onClick={create}>
            Créer les {available.length} réservations
          </Button>
        </div>
      </footer>
    </div>
  );
}
