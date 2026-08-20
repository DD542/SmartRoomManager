import { LifeBuoy, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { AsyncBoundary, EmptyState, Skeleton } from '../ui/States';
import { TicketTable } from './TicketTable';

/** U-22 — bloc « Mes demandes » : suivi des tickets de support. */
export function MyTicketsCard({ tickets, onOpen, onCreate }) {
  return (
    <Card>
      <CardHeader
        title="Mes demandes"
        subtitle="Suivez l’état de vos tickets de support récents."
        action={
          <Button size="sm" icon={Plus} onClick={onCreate}>
            Nouvelle demande d’aide
          </Button>
        }
      />
      <AsyncBoundary
        status={tickets.status}
        error={tickets.error}
        onRetry={tickets.reload}
        isEmpty={tickets.isSuccess && (tickets.data ?? []).length === 0}
        skeleton={<Skeleton className="m-4 h-24" />}
        empty={
          <EmptyState
            icon={LifeBuoy}
            title="Aucune demande en cours"
            description="Ouvrez une demande si aucun article ne répond à votre question."
          />
        }
      >
        <TicketTable tickets={tickets.data ?? []} onOpen={onOpen} />
      </AsyncBoundary>
    </Card>
  );
}
