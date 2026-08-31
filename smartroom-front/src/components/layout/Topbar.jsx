import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { countUnread } from '../../api/notifications';
import { useAuth } from '../../hooks/useAuth';
import { fullName } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/Button';
import { BarreRecherche } from './BarreRecherche';

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
    // `z-topbar` : la barre reste au-dessus du contenu qui défile sous elle,
    // et sous les tiroirs, modales et notifications. La marge haute couvre
    // l'encoche quand l'application est installée en plein écran.
    <header className="z-topbar flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] md:px-4">
      <BarreRecherche
        id="recherche-globale"
        label="Rechercher une salle, une réservation"
        placeholder="Rechercher une salle, une réservation…"
        value={query}
        onChange={setQuery}
        onSubmit={onSubmit}
        className="md:max-w-sm"
      />

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
        {/* L'avatar est la seule porte vers le profil. Un engrenage voisin y
            menait aussi : deux commandes cote a cote pour une meme
            destination, et l'utilisateur hesite entre elles au lieu de
            choisir. Les reglages vivent dans le profil, ou l'on va deja pour
            changer sa photo ou son delai de rappel. */}
        <button
          type="button"
          onClick={() => navigate('/app/profil')}
          className="ml-1 rounded-full ring-2 ring-line transition hover:ring-accent/60"
          aria-label={`Profil et paramètres de ${fullName(user)}`}
        >
          {/* La photo du profil, quand il y en a une. L'`Avatar` sait retomber
              sur les initiales ; ne pas lui passer l'adresse revenait à
              n'afficher jamais que celles-ci, y compris après un dépôt.
              Taille `lg` et anneau : à 32 px, sans contour, la photo se perdait
              dans la barre — on ne la remarquait pas. */}
          <Avatar name={fullName(user)} src={user?.avatarUrl} size="lg" />
        </button>
      </div>
    </header>
  );
}
