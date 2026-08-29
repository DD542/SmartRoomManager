import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
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
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  LifeBuoy,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { normalize } from '../../utils/format';
import { useAdminSession } from '../../hooks/useAdminSession';
import { usePermission } from '../../hooks/usePermission';
import { Tooltip } from '../ui/Tooltip';

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
 * Groupes visibles pour un compte, éventuellement réduits par une recherche.
 *
 * Fonction pure et exportée : c'est elle qui garantit que la barre latérale et
 * la feuille mobile montrent exactement la même chose. Une entrée masquée
 * faute de permission ne peut pas réapparaître d'un côté, puisqu'il n'y a
 * qu'un seul filtre.
 *
 * La recherche ignore accents et casse — « reglement », « Règles » et
 * « REGLES » désignent la même destination pour qui tape vite.
 */
export function groupesVisibles(peut, recherche = '') {
  const terme = normalize(recherche.trim());

  return ADMIN_NAV.map((groupe) => ({
    ...groupe,
    items: groupe.items.filter(
      (item) => peut(item.permission) && (!terme || normalize(item.label).includes(terme)),
    ),
  })).filter((groupe) => groupe.items.length > 0);
}

/**
 * Infobulle facultative.
 *
 * `Tooltip` enveloppe ses enfants dans un `inline-flex` : posée autour d'un
 * lien de barre latérale dépliée, elle lui retirait sa largeur pleine. Elle ne
 * sert qu'en mode réduit, où le libellé a disparu et où il faut bien nommer
 * l'icône au survol.
 */
function PeutEtreInfobulle({ label, children }) {
  if (!label) return children;
  return (
    <Tooltip label={label} side="right" className="w-full">
      {children}
    </Tooltip>
  );
}

const lienClass = (reduit) => ({ isActive }) =>
  cn(
    // 44 px de haut : la feuille mobile utilise les mêmes liens que la barre
    // latérale, et c'est au doigt qu'on les y prend.
    'flex min-h-[44px] items-center gap-2.5 rounded-lg text-sm transition',
    reduit ? 'justify-center px-0' : 'px-2.5',
    isActive
      ? 'bg-accent-soft text-content'
      : 'text-content-muted hover:bg-surface-raised hover:text-content',
  );

/**
 * Liens de l'administration, filtrés par les permissions du compte.
 *
 * Extraits de la barre latérale parce qu'ils servent aussi la feuille mobile :
 * sous 768 px l'`aside` disparaît, et la liste était jusqu'ici enfermée dedans
 * — dix-sept écrans sur dix-huit devenaient inatteignables. Une seule
 * définition, deux enveloppes, un seul filtre.
 *
 * `onNavigate` referme la feuille après un clic ; la barre latérale, qui reste
 * à l'écran, ne le passe pas. `reduit` n'existe que pour elle : une feuille
 * réduite à des icônes n'aurait aucun sens.
 */
export function AdminNav({ onNavigate, reduit = false, recherchable = true }) {
  const navigate = useNavigate();
  const { admin, logout } = useAdminSession();
  const { permissions, peut } = usePermission();
  const [recherche, setRecherche] = useState('');

  const groupes = useMemo(
    () => groupesVisibles(peut, recherchable ? recherche : ''),
    // `peut` est recréé à chaque rendu ; la donnée dont il dépend est la liste
    // des permissions, et c'est elle qu'on observe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recherche, recherchable, permissions],
  );

  return (
    <>
      {recherchable && !reduit && (
        <div className="px-2 pb-1 pt-2">
          <label htmlFor="recherche-navigation" className="sr-only">
            Rechercher une destination
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint"
            />
            <input
              id="recherche-navigation"
              type="search"
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder="Rechercher un écran…"
              className="h-9 w-full rounded-lg border border-line bg-surface-raised pl-8 pr-2 text-xs text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      <nav
        aria-label="Navigation de l’administration"
        className="flex-1 overflow-y-auto px-2 pb-4"
      >
        {groupes.map((groupe, rang) => (
          <div
            key={groupe.id}
            className="mt-4 animate-fade-in-up first:mt-0"
            // Cascade par groupe et non par entrée : dix-huit écrans en
            // dix-huit temps traîneraient. Les domaines se posent l'un après
            // l'autre, chacun d'un bloc.
            style={{ animationDelay: `${rang * 60}ms` }}
          >
            {!reduit && (
              <p className="px-2 pb-1.5 text-[10px] uppercase tracking-wide text-content-faint">
                {groupe.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {groupe.items.map((item) => (
                <li key={item.to}>
                  <PeutEtreInfobulle label={reduit ? item.label : ''}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={lienClass(reduit)}
                      aria-label={reduit ? item.label : undefined}
                    >
                      <item.icon size={15} aria-hidden="true" className="shrink-0" />
                      {!reduit && item.label}
                    </NavLink>
                  </PeutEtreInfobulle>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {groupes.length === 0 && (
          // Recherche sans résultat. Le cas « aucune permission » n'existe
          // pas : deux destinations n'en demandent aucune.
          <p className="mt-4 px-2 text-xs text-content-muted">
            Aucun écran ne correspond à cette recherche.
          </p>
        )}
      </nav>

      <div className="border-t border-line px-2 py-3">
        {!reduit && (
          <p className="px-2.5 pb-2 text-xs text-content-muted">
            {admin ? `${admin.firstName} ${admin.lastName}` : ''}
            <span className="block text-[11px] text-content-faint">{admin?.role}</span>
          </p>
        )}
        <PeutEtreInfobulle label={reduit ? 'Retour à l’espace utilisateur' : ''}>
          <NavLink
            to="/app"
            onClick={onNavigate}
            aria-label="Retour à l’espace utilisateur"
            className={cn(
              'flex min-h-[44px] items-center gap-2.5 rounded-lg text-xs text-content-muted transition hover:bg-surface-raised hover:text-content',
              reduit ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <ArrowLeft size={14} aria-hidden="true" className="shrink-0" />
            {!reduit && 'Retour à l’espace utilisateur'}
          </NavLink>
        </PeutEtreInfobulle>
        <PeutEtreInfobulle label={reduit ? 'Déconnexion' : ''}>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/admin/connexion');
            }}
            aria-label="Déconnexion"
            className={cn(
              'flex min-h-[44px] w-full items-center gap-2.5 rounded-lg text-xs text-content-muted transition hover:bg-surface-raised hover:text-danger',
              reduit ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <LogOut size={14} aria-hidden="true" className="shrink-0" />
            {!reduit && 'Déconnexion'}
          </button>
        </PeutEtreInfobulle>
      </div>
    </>
  );
}

/**
 * Barre latérale fixe, à partir de 768 px.
 *
 * Repliable en colonne d'icônes : entre 768 et 1024 px, ses 240 px prenaient
 * un quart de l'écran au détriment de tables de dix colonnes. Le choix est
 * gardé d'une session à l'autre — un réglage d'espace de travail qu'on refait
 * à chaque visite n'est pas un réglage.
 */
export function AdminSidebar({ reduit = false, onToggle }) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] md:flex',
        reduit ? 'w-[68px]' : 'w-60',
      )}
    >
      <div className={cn('flex items-center gap-2.5 py-4', reduit ? 'justify-center px-2' : 'px-4')}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-ink">
          SR
        </span>
        {!reduit && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content">
              SmartRoom Manager
            </span>
            <span className="block text-[11px] uppercase tracking-wide text-accent">
              Administration
            </span>
          </span>
        )}
      </div>

      <div className={cn('pb-1', reduit ? 'px-2' : 'px-4')}>
        <PeutEtreInfobulle label={reduit ? 'Déplier la navigation' : ''}>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={reduit}
            aria-label={reduit ? 'Déplier la navigation' : 'Replier la navigation'}
            className={cn(
              'flex min-h-[44px] items-center gap-2 rounded-lg text-xs text-content-muted transition hover:bg-surface-raised hover:text-content',
              reduit ? 'w-full justify-center' : 'w-full px-2.5',
            )}
          >
            {reduit ? (
              <PanelLeftOpen size={15} aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose size={15} aria-hidden="true" />
                Replier
              </>
            )}
          </button>
        </PeutEtreInfobulle>
      </div>

      <AdminNav reduit={reduit} recherchable={!reduit} />
    </aside>
  );
}
