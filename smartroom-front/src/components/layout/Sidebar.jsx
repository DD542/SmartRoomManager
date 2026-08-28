import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck,
  CalendarPlus,
  CircleCheck,
  DoorOpen,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Map,
  Settings,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../hooks/useAuth';
import { Tooltip } from '../ui/Tooltip';

/**
 * Destinations principales de l'espace utilisateur.
 *
 * Exportée : la barre latérale les montre en desktop, le tiroir mobile reprend
 * celles que la barre d'onglets ne peut pas loger. Une seule liste, donc aucune
 * destination ne peut disparaître d'un côté sans qu'on le voie de l'autre.
 */
export const NAV_ITEMS = [
  { to: '/app', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/app/salles', label: 'Explorer les salles', icon: DoorOpen },
  { to: '/app/reservations', label: 'Mes réservations', icon: CalendarCheck },
  // U-19 n'était atteignable que depuis la barre mobile : en desktop, l'écran
  // existait dans le routeur sans qu'aucun chemin d'interface n'y mène.
  { to: '/app/check-in', label: 'Valider ma présence', icon: CircleCheck },
  { to: '/app/plan', label: 'Plan du bâtiment', icon: Map },
  { to: '/app/statistiques', label: 'Mes statistiques', icon: BarChart3 },
  { to: '/app/aide', label: 'Centre d’aide', icon: HelpCircle },
];

// 44 px de côté : minimum recommandé par WCAG 2.1 (2.5.5). La barre reste
// visible dès 768 px, où l'écran est très souvent tactile.
const itemClass = ({ isActive }) =>
  cn(
    'relative flex h-11 w-11 items-center justify-center rounded-xl border transition',
    isActive
      ? 'border-accent/50 bg-accent-soft text-accent-bright'
      : 'border-transparent text-content-muted hover:bg-surface-raised hover:text-content',
  );

/** Barre latérale icônes seules : navigation principale, actions ancrées en bas. */
export function Sidebar() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <aside className="hidden w-[68px] shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-3 md:flex">
      <NavLink
        to="/app"
        aria-label="SmartRoom Manager, retour à l’accueil"
        className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-ink"
      >
        SR
      </NavLink>

      <Tooltip label="Nouvelle réservation" side="right">
        <button
          type="button"
          onClick={() => navigate('/app/reservation/besoin')}
          aria-label="Nouvelle réservation"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-raised text-accent transition hover:border-accent/50"
        >
          <CalendarPlus size={18} aria-hidden="true" />
        </button>
      </Tooltip>

      <nav aria-label="Navigation principale" className="mt-2 flex flex-col items-center gap-1">
        {/* Cascade de 35 ms : la barre se pose du haut vers le bas au lieu
            d'apparaître d'un bloc. Le décalage est porté par une variable de
            style et non par une classe, une classe Tailwind ne pouvant pas
            dépendre d'un indice. */}
        {NAV_ITEMS.map((item, index) => (
          <Tooltip key={item.to} label={item.label} side="right">
            <NavLink
              to={item.to}
              end={item.end}
              className={(etat) => cn(itemClass(etat), 'animate-fade-in-up')}
              style={{ animationDelay: `${index * 35}ms` }}
              aria-label={item.label}
            >
              <item.icon size={18} aria-hidden="true" />
            </NavLink>
          </Tooltip>
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip label="Profil et paramètres" side="right">
          <NavLink to="/app/profil" className={itemClass} aria-label="Profil et paramètres">
            <Settings size={18} aria-hidden="true" />
          </NavLink>
        </Tooltip>
        <Tooltip label="Se déconnecter" side="right">
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/connexion');
            }}
            aria-label="Se déconnecter"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-transparent text-content-muted transition hover:bg-surface-raised hover:text-danger"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
