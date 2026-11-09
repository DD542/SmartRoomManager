import { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarRange,
  DoorOpen,
  FileClock,
  LayoutDashboard,
  LogOut,
  Mail,
  Map,
  Monitor,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UserCog,
  LifeBuoy,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAdminSession } from '../../hooks/useAdminSession';
import { usePermission } from '../../hooks/usePermission';
import { Logo } from '../brand/Logo';
import { IndicateurLiquide } from '../ui/IndicateurLiquide';

/** Navigation de l'administration, groupée comme les écrans du manifeste. */
export const ADMIN_NAV = [
  {
    id: 'pilotage',
    label: 'Pilotage',
    items: [
      { to: '/admin', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/admin/rapports', label: 'Statistiques', icon: BarChart3, permission: 'data.export' },
    ],
  },
  {
    id: 'reservations',
    label: 'Réservations',
    items: [
      { to: '/admin/reservations', label: 'Toutes les réservations', icon: CalendarRange },
      {
        to: '/admin/conflits',
        label: 'Conflits et demandes',
        icon: AlertTriangle,
        permission: 'conflicts.arbitrate',
      },
    ],
  },
  {
    id: 'espaces',
    label: 'Espaces',
    items: [
      { to: '/admin/batiments', label: 'Bâtiments', icon: Building2, permission: 'rooms.manage' },
      { to: '/admin/salles', label: 'Salles', icon: DoorOpen, permission: 'rooms.manage' },
      { to: '/admin/equipements', label: 'Équipements', icon: Monitor, permission: 'rooms.manage' },
      { to: '/admin/plans', label: 'Plans', icon: Map, permission: 'rooms.manage' },
    ],
  },
  {
    id: 'regles',
    label: 'Règles',
    items: [
      {
        to: '/admin/ouvertures',
        label: 'Ouvertures',
        icon: CalendarClock,
        permission: 'rules.configure',
      },
      {
        to: '/admin/regles',
        label: 'Règles de réservation',
        icon: SlidersHorizontal,
        permission: 'rules.configure',
      },
    ],
  },
  {
    id: 'personnes',
    label: 'Personnes',
    items: [
      { to: '/admin/utilisateurs', label: 'Utilisateurs', icon: Users, permission: 'users.manage' },
      { to: '/admin/roles', label: 'Rôles', icon: UserCog, permission: 'system.configure' },
    ],
  },
  {
    id: 'assistance',
    label: 'Assistance',
    items: [
      { to: '/admin/tickets', label: 'Tickets', icon: LifeBuoy, permission: 'support.handle' },
      {
        to: '/admin/connaissances',
        label: 'Base de connaissances',
        icon: ShieldCheck,
        permission: 'support.handle',
      },
      { to: '/admin/modeles', label: 'Modèles d’e-mails', icon: Mail, permission: 'system.configure' },
      { to: '/admin/audit', label: 'Journal d’audit', icon: FileClock, permission: 'system.configure' },
    ],
  },
];

/**
 * Liens de l'administration, filtrés par les permissions du compte.
 *
 * Extraits de la barre latérale parce qu'ils servent aussi la feuille mobile :
 * sous 768 px l'`aside` disparaît, et la liste était jusqu'ici enfermée dedans
 * — dix-sept écrans sur dix-huit devenaient inatteignables. Une seule
 * définition, deux enveloppes.
 *
 * `onNavigate` referme la feuille après un clic ; la barre latérale, qui reste
 * à l'écran, ne le passe pas.
 */
export function AdminNav({ onNavigate }) {
  const navigate = useNavigate();
  const { admin, logout } = useAdminSession();
  const { peut } = usePermission();
  const nav = useRef(null);

  return (
    <>
      <nav
        ref={nav}
        aria-label="Navigation de l’administration"
        className="relative flex-1 overflow-y-auto px-2 pb-4"
      >
        <IndicateurLiquide conteneur={nav} />
        {ADMIN_NAV.map((groupe) => {
          const visibles = groupe.items.filter((item) => peut(item.permission));
          if (visibles.length === 0) return null;

          // Cascade par groupe et non par entrée : dix-huit écrans en
          // dix-huit temps traîneraient. Les quatre domaines se posent l'un
          // après l'autre, chacun d'un bloc.
          const rang = ADMIN_NAV.indexOf(groupe);

          return (
            <div
              key={groupe.id}
              className="mt-4 animate-fade-in-up first:mt-0"
              style={{ animationDelay: `${rang * 60}ms` }}
            >
              <p className="px-3 pb-1.5 text-[11px] font-medium text-content-faint">
                {groupe.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {visibles.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          // 44 px au téléphone, où cette liste est le tiroir de
                          // navigation et compte dix-sept entrées empilées :
                          // 36 px les rendaient voisines au point de se
                          // toucher. À partir de `lg`, la barre latérale reprend
                          // sa densité — elle se vise à la souris, et dix-sept
                          // entrées à 44 px ne tiendraient plus dans la hauteur.
                          'pression relative z-[1] flex min-h-[44px] items-center gap-3 rounded-full px-3 py-2 text-sm transition-colors lg:min-h-[36px]',
                          isActive
                            ? 'font-semibold text-content'
                            : 'text-content-muted hover:text-content',
                        )
                      }
                    >
                      <item.icon size={16} aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line/60 px-2 py-3">
        <p className="px-2.5 pb-2 text-xs text-content-muted">
          {admin ? `${admin.firstName} ${admin.lastName}` : ''}
          <span className="block text-[11px] text-content-faint">{admin?.role}</span>
        </p>
        <NavLink
          to="/app"
          onClick={onNavigate}
          className="pression flex min-h-[44px] items-center gap-2.5 rounded-full px-3 py-2 text-xs text-content-muted transition-colors hover:bg-content/[0.06] hover:text-content lg:min-h-0"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Retour à l’espace utilisateur
        </NavLink>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/admin/connexion');
          }}
          className="pression flex min-h-[44px] w-full items-center gap-2.5 rounded-full px-3 py-2 text-xs text-content-muted transition-colors hover:bg-content/[0.06] hover:text-danger lg:min-h-0"
        >
          <LogOut size={14} aria-hidden="true" />
          Déconnexion
        </button>
      </div>
    </>
  );
}

/** Barre latérale fixe, à partir de 768 px. */
export function AdminSidebar() {
  return (
    <aside className="verre-epais sticky top-3 m-3 mr-0 hidden h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col overflow-hidden rounded-3xl md:flex">
      <div className="flex flex-col gap-2 px-5 pb-4 pt-5">
        <Logo />
        <span className="w-fit rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-ink">
          Administration
        </span>
      </div>
      <AdminNav />
    </aside>
  );
}
