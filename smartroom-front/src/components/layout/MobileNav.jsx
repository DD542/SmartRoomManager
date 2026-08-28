import { NavLink } from 'react-router-dom';
import { CalendarCheck, CircleCheck, DoorOpen, LayoutDashboard, User } from 'lucide-react';
import { cn } from '../../utils/cn';

const ITEMS = [
  { to: '/app', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/app/salles', label: 'Salles', icon: DoorOpen },
  { to: '/app/reservations', label: 'Réservations', icon: CalendarCheck },
  // Sans identifiant : « bk-1001 » venait des maquettes, et chaque appui
  // menait à « booking_id doit être un identifiant valide ». L'écran
  // d'entrée cherche la réservation du moment.
  { to: '/app/check-in', label: 'Check-in', icon: CircleCheck },
  { to: '/app/profil', label: 'Profil', icon: User },
];

/** Barre d'onglets basse, active sous 768px : la sidebar disparaît alors. */
export function MobileNav() {
  return (
    <nav
      aria-label="Navigation principale"
      className="sticky bottom-0 z-30 flex shrink-0 border-t border-line bg-surface md:hidden"
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition',
              isActive ? 'text-accent' : 'text-content-muted',
            )
          }
        >
          <item.icon size={18} aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
