import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { CalendarCheck, CircleCheck, DoorOpen, House, MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';
import { IndicateurLiquide } from '../ui/IndicateurLiquide';

/**
 * Les quatre destinations que la barre peut loger sans se tasser. Le reste —
 * plan, statistiques, aide, notifications, profil — passe par le tiroir : ce
 * sont les entrées qui disparaissaient purement et simplement sous 768 px.
 */
const ITEMS = [
  { to: '/app', label: 'Accueil', icon: House, end: true },
  { to: '/app/salles', label: 'Salles', icon: DoorOpen },
  { to: '/app/reservations', label: 'Réservations', icon: CalendarCheck },
  // Sans identifiant : « bk-1001 » venait des maquettes, et chaque appui
  // menait à « booking_id doit être un identifiant valide ». L'écran
  // d'entrée cherche la réservation du moment.
  { to: '/app/check-in', label: 'Check-in', icon: CircleCheck },
];

// 56 px de haut : au-dessus du minimum tactile de 44 px, avec la place du
// libellé sous l'icône.
const ongletClass =
  'pression relative z-[1] flex min-h-[56px] flex-1 animate-fade-in-up flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors';

/**
 * Barre d'onglets flottante, de la même surface que les cartes, active sous
 * 768 px.
 *
 * Elle flotte au-dessus du contenu, décollée des bords, comme la barre
 * d'onglets d'iOS : le contenu défile dessous et transparaît au travers. La
 * bulle de l'onglet actif glisse d'un onglet à l'autre. La marge basse tient
 * compte de l'indicateur d'accueil des téléphones à barre gestuelle.
 */
export function MobileNav({ onOpenMore, moreOpen = false }) {
  const barre = useRef(null);

  return (
    <nav
      ref={barre}
      aria-label="Navigation principale"
      className="border border-line/70 bg-surface/90 backdrop-blur-xl fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-mobilenav flex rounded-full p-1.5 shadow-haute md:hidden"
    >
      <IndicateurLiquide conteneur={barre} />
      {ITEMS.map((item, index) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          // Cascade de gauche à droite, comme la barre latérale du bureau
          // descend de haut en bas : le même geste, adapté à l'axe de l'écran.
          style={{ animationDelay: `${index * 30}ms` }}
          className={({ isActive }) =>
            cn(ongletClass, isActive ? 'text-content bg-accent-soft [[data-bulle-prete=true]_&]:bg-transparent [[data-bulle-prete=true]_&]:text-ink' : 'text-content-muted')
          }
        >
          {({ isActive }) => (
            <>
              <item.icon size={20} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
              {item.label}
            </>
          )}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={onOpenMore}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        style={{ animationDelay: `${ITEMS.length * 30}ms` }}
        className={cn(ongletClass, moreOpen ? 'text-content' : 'text-content-muted')}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
        Plus
      </button>
    </nav>
  );
}
