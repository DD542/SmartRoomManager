import { CalendarDays, CalendarX2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../ui/States';
import { DetailPanel } from '../DetailPanel';
import { BookingCalendar } from './BookingCalendar';
import { BookingDetail } from './BookingDetail';
import { BookingsTable } from './BookingsTable';

/**
 * A-03 — plan de travail : la liste à gauche, le détail à droite.
 *
 * Table et calendrier partagent la même sélection : passer d'une vue à l'autre
 * ne fait pas perdre la réservation ouverte dans le volet.
 */
export function BookingsWorkspace({
  query,
  rows,
  table,
  view,
  selection,
  onSelect,
  onCancel,
  onReset,
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
      <AsyncBoundary
        status={query.status}
        error={query.error}
        onRetry={query.reload}
        isEmpty={rows.length === 0}
        skeleton={<SkeletonCard />}
        empty={
          <Card>
            <EmptyState
              icon={CalendarX2}
              title="Aucune réservation"
              description="Aucune ligne ne correspond aux filtres appliqués."
              action={
                <Button variant="secondary" size="sm" onClick={onReset}>
                  Réinitialiser les filtres
                </Button>
              }
            />
          </Card>
        }
      >
        <Card className="overflow-hidden">
          {view === 'table' ? (
            <BookingsTable table={table} onSelect={onSelect} selectedId={selection?.id} />
          ) : (
            <BookingCalendar
              bookings={query.data ?? []}
              onSelect={onSelect}
              isLoading={query.isLoading}
            />
          )}
        </Card>
      </AsyncBoundary>

      <DetailPanel
        title={selection?.title}
        subtitle={selection?.room?.name}
        emptyIcon={CalendarDays}
        emptyDescription="Choisissez une réservation pour afficher son détail et son historique."
        onClose={() => onSelect(null)}
      >
        {selection && <BookingDetail booking={selection} onCancel={onCancel} />}
      </DetailPanel>
    </div>
  );
}
