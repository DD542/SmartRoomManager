import { NavLink } from 'react-router-dom';
import { CalendarCheck, CircleCheck, DoorOpen, LayoutDashboard, MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Les quatre destinations que la barre peut loger sans se tasser. Le reste —
 * plan, statistiques, aide, notifications, profil — passe par le tiroir : ce
 * sont les entrées qui disparaissaient purement et simplement sous 768 px.
 */
const ITEMS = [
  { to: '/app', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/app/salles', label: 'Salles', icon: DoorOpen },
  { to: '/app/reservations', label: 'Réservations', icon: CalendarCheck },
  // Sans identifiant : « bk-1001 » venait des maquettes, et chaque appui
  // menait à « booking_id doit être un identifiant valide ». L'écran
  // d'entrée cherche la réservation du moment.
  { to: '/app/check-in', label: 'Check-in', icon: CircleCheck },
];

// 56 px de haut, plus la marge du système : sur un téléphone à barre gestuelle,
// la dernière rangée passait sous l'indicateur d'accueil.
const ongletClass = 'flex min-h-[56px] flex-1 animate-fade-in-up flex-col items-center justify-center gap-1 py-2 text-[10px] transition';

/**
 * Barre d'onglets basse, active sous 768 px : la barre latérale disparaît
 * alors, et rien ne la remplaçait pour trois destinations sur sept.
 */
export function MobileNav({ onOpenMore, moreOpen = false }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="z-mobilenav flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map((item, index) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          // Cascade de gauche à droite, comme la barre latérale du bureau
          // descend de haut en bas : le même geste, adapté à l'axe de l'écran.
          style={{ animationDelay: `${index * 30}ms` }}
          className={({ isActive }) =>
            cn(ongletClass, isActive ? 'text-accent' : 'text-content-muted')
          }
        >
          <item.icon size={18} aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={onOpenMore}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        style={{ animationDelay: `${ITEMS.length * 30}ms` }}
        className={cn(ongletClass, moreOpen ? 'text-accent' : 'text-content-muted')}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
        Plus
      </button>
    </nav>
  );
}
