import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, FileClock, Menu, Search } from 'lucide-react';
import { countQueue } from '../../api/admin/conflicts';
import { useAdminSession } from '../../hooks/useAdminSession';
import { usePermission } from '../../hooks/usePermission';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/Button';
import { plural } from '../../utils/format';

/** Barre haute de l'administration : recherche, file d'arbitrage, audit, compte. */
export function AdminTopbar({ onOpenMenu }) {
  const navigate = useNavigate();
  const { admin } = useAdminSession();
  const { peut } = usePermission();
  const [query, setQuery] = useState('');
  const [enAttente, setEnAttente] = useState(0);

  useEffect(() => {
    let annule = false;
    countQueue()
      .then((compteurs) => {
        if (!annule) setEnAttente(compteurs.tous);
      })
      .catch(() => {
        if (!annule) setEnAttente(0);
      });
    return () => {
      annule = true;
    };
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 md:px-4">
      {/* Ouvre la navigation en feuille : sous 768 px la barre latérale est
          masquée, et sans ce bouton aucun écran d'administration n'est
          atteignable. */}
      <span className="md:hidden">
        <IconButton icon={Menu} label="Ouvrir la navigation" onClick={onOpenMenu} />
      </span>

      <form
        role="search"
        className="relative min-w-0 flex-1 md:max-w-md"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length >= 2) {
            navigate(`/admin/reservations?q=${encodeURIComponent(query.trim())}`);
          }
        }}
      >
        <label htmlFor="recherche-admin" className="sr-only">
          Rechercher une réservation, une salle ou un utilisateur
        </label>
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
        />
        <input
          id="recherche-admin"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une réservation, une salle, un utilisateur…"
          className="h-9 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        {peut('conflicts.arbitrate') && (
          <span className="relative">
            <IconButton
              icon={AlertTriangle}
              label={
                enAttente > 0
                  ? `File d’arbitrage, ${plural(enAttente, 'élément')} en attente`
                  : 'File d’arbitrage'
              }
              onClick={() => navigate('/admin/conflits')}
            />
            {enAttente > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-surface bg-warning px-1 font-mono text-[9px] text-ink"
              >
                {enAttente}
              </span>
            )}
          </span>
        )}
        {peut('system.configure') && (
          <IconButton
            icon={FileClock}
            label="Journal d’audit"
            onClick={() => navigate('/admin/audit')}
          />
        )}
        <IconButton icon={Bell} label="Notifications" onClick={() => navigate('/admin')} />
        <span className="ml-1">
          <Avatar name={admin ? `${admin.firstName} ${admin.lastName}` : 'Administration'} />
        </span>
      </div>
    </header>
  );
}
