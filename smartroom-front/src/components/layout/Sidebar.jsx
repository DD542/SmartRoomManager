import { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck,
  CircleCheck,
  DoorOpen,
  HelpCircle,
  House,
  LogOut,
  Map,
  Plus,
  Settings,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../hooks/useAuth';
import { Logo } from '../brand/Logo';
import { IndicateurLiquide } from '../ui/IndicateurLiquide';

/**
 * Destinations principales de l'espace utilisateur.
 *
 * Exportée : la barre latérale les montre en desktop, le tiroir mobile reprend
 * celles que la barre d'onglets ne peut pas loger. Une seule liste, donc aucune
 * destination ne peut disparaître d'un côté sans qu'on le voie de l'autre.
 */
export const NAV_ITEMS = [
  { to: '/app', label: 'Accueil', icon: House, end: true },
  { to: '/app/salles', label: 'Explorer les salles', icon: DoorOpen },
  { to: '/app/reservations', label: 'Mes réservations', icon: CalendarCheck },
  // U-19 n'était atteignable que depuis la barre mobile : en desktop, l'écran
  // existait dans le routeur sans qu'aucun chemin d'interface n'y mène.
  { to: '/app/check-in', label: 'Valider ma présence', icon: CircleCheck },
  { to: '/app/plan', label: 'Plan du bâtiment', icon: Map },
  { to: '/app/statistiques', label: 'Mes statistiques', icon: BarChart3 },
  { to: '/app/aide', label: 'Centre d’aide', icon: HelpCircle },
];

// 44 px de haut : minimum recommandé par WCAG 2.1 (2.5.5). Icône seule entre
// 768 et 1024 px, libellé au-delà — la maquette montre le libellé, mais une
// tablette en portrait n'a pas la place de le loger à côté du contenu.
const itemClass = ({ isActive }) =>
  cn(
    'pression relative z-[1] flex h-11 items-center justify-center gap-3 rounded-full px-0 text-sm transition-colors',
    'w-11 lg:w-full lg:justify-start lg:px-3.5',
    isActive ? 'font-semibold text-content bg-accent-soft [[data-bulle-prete=true]_&]:bg-transparent [[data-bulle-prete=true]_&]:text-ink' : 'text-content-muted hover:text-content',
  );

/**
 * Barre latérale flottante, de la même surface que les cartes du tableau de
 * bord : logo, action principale,
 * navigation dont l'entrée active est portée par une bulle qui glisse.
 */
export function Sidebar() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const nav = useRef(null);

  return (
    <aside className="border border-line/70 bg-surface/85 shadow-carte backdrop-blur-xl sticky top-3 m-3 mr-0 hidden h-[calc(100vh-1.5rem)] w-[76px] shrink-0 flex-col items-center gap-2 rounded-3xl px-2.5 py-5 md:flex lg:w-60 lg:items-stretch lg:px-4">
      <NavLink
        to="/app"
        aria-label="SmartRoom Manager, retour à l’accueil"
        className="mb-4 flex justify-center lg:justify-start lg:px-1.5"
      >
        <Logo compact className="lg:hidden" />
        <Logo className="hidden lg:inline-flex" />
      </NavLink>

      <button
        type="button"
        onClick={() => navigate('/app/reservation/besoin')}
        aria-label="Nouvelle réservation"
        title="Nouvelle réservation"
        className="pression mb-3 flex h-11 w-11 items-center justify-center gap-2 rounded-full bg-corail text-sm font-semibold text-[#0C1547] shadow-[0_12px_26px_-12px_rgb(255_128_83/0.85)] transition-[filter,box-shadow,transform,scale] hover:-translate-y-px hover:brightness-105 lg:w-full"
      >
        <Plus size={18} aria-hidden="true" />
        <span className="hidden lg:inline">Nouvelle réservation</span>
      </button>

      <nav ref={nav} aria-label="Navigation principale" className="relative flex flex-col items-center gap-1 lg:items-stretch">
        <IndicateurLiquide conteneur={nav} />
        {/* Cascade de 35 ms : la barre se pose du haut vers le bas au lieu
            d'apparaître d'un bloc. Le décalage est porté par une variable de
            style et non par une classe, une classe Tailwind ne pouvant pas
            dépendre d'un indice. */}
        {NAV_ITEMS.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={(etat) => cn(itemClass(etat), 'animate-fade-in-up')}
            style={{ animationDelay: `${index * 35}ms` }}
            aria-label={item.label}
            title={item.label}
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={19}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span className="hidden truncate lg:inline">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 border-t border-line/60 pt-3 lg:items-stretch">
        <NavLink to="/app/profil" className={itemClass} aria-label="Profil et paramètres" title="Profil et paramètres">
          <Settings size={19} aria-hidden="true" className="shrink-0" />
          <span className="hidden lg:inline">Paramètres</span>
        </NavLink>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/connexion');
          }}
          aria-label="Se déconnecter"
          title="Se déconnecter"
          className={cn(itemClass({ isActive: false }), 'hover:text-danger')}
        >
          <LogOut size={19} aria-hidden="true" className="shrink-0" />
          <span className="hidden lg:inline">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
