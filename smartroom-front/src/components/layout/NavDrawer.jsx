import { NavLink, useNavigate } from 'react-router-dom';
import { Bell, CalendarPlus, LogOut, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/Button';
import { BottomSheet } from '../ui/Modal';
import { NAV_ITEMS } from './Sidebar';

/** Destinations déjà logées dans la barre d'onglets : le tiroir ne les répète pas. */
const DANS_LA_BARRE = new Set(['/app', '/app/salles', '/app/reservations', '/app/check-in']);

/** Le reste de la navigation, plus ce que la barre latérale ancre en bas. */
const SECONDAIRES = [
  { to: '/app/notifications', label: 'Notifications', icon: Bell },
  { to: '/app/profil', label: 'Profil et paramètres', icon: Settings },
];

const lienClass = ({ isActive }) =>
  cn(
    // 48 px : la cible tactile d'une liste se prend au pouce, souvent en
    // marchant. Le minimum de 44 px est un plancher, pas un objectif.
    'flex min-h-[48px] items-center gap-3 rounded-xl border px-3 text-sm transition',
    isActive
      ? 'border-accent/50 bg-accent-soft text-content'
      : 'border-line bg-surface-raised text-content-muted hover:text-content',
  );

/**
 * Tiroir de navigation secondaire, sous 768 px.
 *
 * La barre latérale porte sept destinations ; la barre d'onglets en loge
 * quatre sans se tasser. Les trois restantes — plan, statistiques, aide —
 * disparaissaient simplement de l'interface mobile : elles existaient dans le
 * routeur, atteignables par aucun geste. Le tiroir les reprend, avec ce que la
 * barre latérale ancre en bas : notifications, profil, déconnexion.
 *
 * Il s'appuie sur `BottomSheet`, qui piège le focus, ferme sur Échap et rend
 * le focus au bouton d'ouverture — la même mécanique que le tiroir de
 * l'administration, plutôt qu'une seconde à maintenir.
 */
export function NavDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const reprises = NAV_ITEMS.filter((item) => !DANS_LA_BARRE.has(item.to));

  const aller = (to) => {
    onClose();
    navigate(to);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Navigation">
      <div className="flex flex-col gap-4 pb-[env(safe-area-inset-bottom)]">
        <Button
          fullWidth
          icon={CalendarPlus}
          onClick={() => aller('/app/reservation/besoin')}
        >
          Nouvelle réservation
        </Button>

        <ul className="flex flex-col gap-1.5">
          {[...reprises, ...SECONDAIRES].map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} onClick={onClose} className={lienClass}>
                <item.icon size={16} aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <Button
          variant="ghost"
          fullWidth
          icon={LogOut}
          onClick={() => {
            onClose();
            logout();
            navigate('/connexion');
          }}
          className="justify-start text-content-muted hover:text-danger"
        >
          Se déconnecter
        </Button>
      </div>
    </BottomSheet>
  );
}
