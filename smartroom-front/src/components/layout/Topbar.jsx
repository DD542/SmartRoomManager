import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, Settings } from 'lucide-react';
import { countUnread } from '../../api/notifications';
import { useAuth } from '../../hooks/useAuth';
import { fullName } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/Button';

/** Barre haute : recherche globale, notifications, paramètres, avatar. */
export function Topbar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    countUnread()
      .then((count) => {
        if (!cancelled) setUnread(count);
      })
      .catch(() => {
        if (!cancelled) setUnread(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = (event) => {
    event.preventDefault();
    if (query.trim().length >= 2) navigate(`/app/recherche?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 md:px-4">
      <form role="search" onSubmit={onSubmit} className="relative min-w-0 flex-1 md:max-w-sm">
        <label htmlFor="recherche-globale" className="sr-only">
          Rechercher une salle, une réservation
        </label>
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
        />
        <input
          id="recherche-globale"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une salle, une réservation…"
          className="h-9 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content
                     placeholder:text-content-faint focus:border-accent focus:outline-none"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <span className="relative">
          <IconButton
            icon={Bell}
            label={unread > 0 ? `Notifications, ${unread} non lues` : 'Notifications'}
            onClick={() => navigate('/app/notifications')}
          />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-surface bg-accent"
            />
          )}
        </span>
        <IconButton icon={Settings} label="Paramètres" onClick={() => navigate('/app/profil')} />
        <button
          type="button"
          onClick={() => navigate('/app/profil')}
          className="ml-1 rounded-full"
          aria-label={`Profil de ${fullName(user)}`}
        >
          <Avatar name={fullName(user)} />
        </button>
      </div>
    </header>
  );
}
