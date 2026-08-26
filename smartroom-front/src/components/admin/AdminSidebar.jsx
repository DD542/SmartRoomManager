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

  return (
    <>
      <nav aria-label="Navigation de l’administration" className="flex-1 overflow-y-auto px-2 pb-4">
        {ADMIN_NAV.map((groupe) => {
          const visibles = groupe.items.filter((item) => peut(item.permission));
          if (visibles.length === 0) return null;

          return (
            <div key={groupe.id} className="mt-4 first:mt-0">
              <p className="px-2 pb-1.5 text-[10px] uppercase tracking-wide text-content-faint">
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
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                          isActive
                            ? 'bg-accent-soft text-content'
                            : 'text-content-muted hover:bg-surface-raised hover:text-content',
                        )
                      }
                    >
                      <item.icon size={15} aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line px-2 py-3">
        <p className="px-2.5 pb-2 text-xs text-content-muted">
          {admin ? `${admin.firstName} ${admin.lastName}` : ''}
          <span className="block text-[11px] text-content-faint">{admin?.role}</span>
        </p>
        <NavLink
          to="/app"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-content-muted transition hover:bg-surface-raised hover:text-content"
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
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-content-muted transition hover:bg-surface-raised hover:text-danger"
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
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-ink">
          SR
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-content">SmartRoom Manager</span>
          <span className="block text-[11px] uppercase tracking-wide text-accent">Administration</span>
        </span>
      </div>
      <AdminNav />
    </aside>
  );
}
