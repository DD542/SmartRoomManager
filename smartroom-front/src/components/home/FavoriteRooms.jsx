import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { fmtCapacity, ROOM_STATUS_LABEL } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { Card, SectionTitle } from '../ui/Card';
import { EmptyState, Skeleton } from '../ui/States';

const TONE = { disponible: 'success', occupee: 'danger', maintenance: 'warning' };

/** U-01 — salles favorites, déduites des salles les plus réservées par l'utilisateur. */
export function FavoriteRooms({ rooms = [], isLoading }) {
  return (
    <Card className="flex h-full flex-col">
      <SectionTitle title="Salles favorites" icon={Heart} to="/app/salles" className="px-4 py-3" />

      {isLoading && (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {!isLoading && rooms.length === 0 && (
        <EmptyState
          icon={Heart}
          title="Pas encore de favorite"
          description="Les salles que vous réservez le plus souvent apparaîtront ici."
        />
      )}

      {!isLoading && rooms.length > 0 && (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          {rooms.map((room) => (
            <Link
              key={room.id}
              to={`/app/salles/${room.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-surface-raised transition hover:border-line-strong"
            >
              <img
                src={room.photos?.[0]}
                alt=""
                className="h-20 w-full object-cover"
                loading="lazy"
              />
              <span className="block px-3 py-2">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-content">{room.name}</span>
                  <Badge tone={TONE[room.status] ?? 'default'} dot>
                    {ROOM_STATUS_LABEL[room.status]}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-xs text-content-muted">
                  {fmtCapacity(room.capacity)} • {room.building?.name ?? ''}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
