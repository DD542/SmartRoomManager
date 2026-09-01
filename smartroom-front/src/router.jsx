import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';

import PublicLayout from './layouts/PublicLayout';
import AuthLayout from './layouts/AuthLayout';
import AppLayout from './layouts/AppLayout';
import WizardLayout from './layouts/WizardLayout';

import LandingPage from './pages/public/LandingPage';
import LegalPage from './pages/public/LegalPage';
import LoginPage from './pages/public/LoginPage';
import ForgotPasswordPage from './pages/public/ForgotPasswordPage';
import OnboardingPage from './pages/onboarding/OnboardingPage';
import DashboardPage from './pages/home/DashboardPage';
import NeedFormPage from './pages/booking/NeedFormPage';
import EligibleRoomsPage from './pages/booking/EligibleRoomsPage';
import RoomAvailabilityPage from './pages/booking/RoomAvailabilityPage';
import SummaryPage from './pages/booking/SummaryPage';
import ConfirmedPage from './pages/booking/ConfirmedPage';
import MyBookingsListPage from './pages/manage/MyBookingsListPage';
import MyBookingsCalendarPage from './pages/manage/MyBookingsCalendarPage';
import BookingDetailPage from './pages/manage/BookingDetailPage';
import EditBookingPage from './pages/manage/EditBookingPage';
import ConflictPage from './pages/edge/ConflictPage';
import ExceptionalAccessPage from './pages/edge/ExceptionalAccessPage';
import RecurringBookingPage from './pages/edge/RecurringBookingPage';
import InvitationPage from './pages/edge/InvitationPage';
import ExploreRoomsPage from './pages/catalog/ExploreRoomsPage';
import RoomDetailPage from './pages/catalog/RoomDetailPage';
import FloorPlanPage from './pages/catalog/FloorPlanPage';
import CheckInPage from './pages/onsite/CheckInPage';
import CheckInEntryPage from './pages/onsite/CheckInEntryPage';
import NotificationsPage from './pages/account/NotificationsPage';
import ProfilePage from './pages/account/ProfilePage';
import HelpCenterPage from './pages/account/HelpCenterPage';
import StatsPage from './pages/account/StatsPage';
import GlobalSearchPage from './pages/system/GlobalSearchPage';
import NotFoundPage from './pages/system/NotFoundPage';
import ForbiddenPage from './pages/system/ForbiddenPage';

import AdminLayout from './layouts/AdminLayout';
import { useAdminSession } from './hooks/useAdminSession';
import { usePermission } from './hooks/usePermission';
import { PermissionDenied } from './components/admin/PermissionGate';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import OccupancyDashboardPage from './pages/admin/dashboard/OccupancyDashboardPage';
import ReportsPage from './pages/admin/reports/ReportsPage';
import AllBookingsPage from './pages/admin/bookings/AllBookingsPage';
import ConflictQueuePage from './pages/admin/bookings/ConflictQueuePage';
import RoomsPage from './pages/admin/rooms/RoomsPage';
import RoomEditPage from './pages/admin/rooms/RoomEditPage';
import EquipmentPage from './pages/admin/rooms/EquipmentPage';
import PlansPage from './pages/admin/rooms/PlansPage';
import SchedulesPage from './pages/admin/rules/SchedulesPage';
import BookingRulesPage from './pages/admin/rules/BookingRulesPage';
import UsersPage from './pages/admin/people/UsersPage';
import RolesPage from './pages/admin/people/RolesPage';
import TicketsPage from './pages/admin/support/TicketsPage';
import KnowledgePage from './pages/admin/support/KnowledgePage';
import EmailTemplatesPage from './pages/admin/support/EmailTemplatesPage';
import AdminProfilePage from './pages/admin/account/AdminProfilePage';
import BuildingsPage from './pages/admin/rooms/BuildingsPage';
import { Spinner } from './components/ui/States';
import RootRedirect from './pages/RootRedirect';
import AuditLogPage from './pages/admin/audit/AuditLogPage';

/**
 * Écran d'attente des gardes, le temps que la session soit reprise.
 *
 * Neutre et sans marque : il ne s'affiche qu'une fraction de seconde, et il
 * doit pouvoir précéder aussi bien l'espace utilisateur que l'administration.
 */
function RepriseDeSession() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink">
      <Spinner label="Reprise de la session…" />
    </div>
  );
}

/**
 * Garde d'authentification : mémorise l'URL demandée pour y revenir après
 * connexion.
 *
 * Exportée pour être montée seule dans les tests : c'est une décision à trois
 * issues — attendre, rediriger, laisser passer — et la vérifier à travers
 * l'application entière demanderait de simuler tout le reste.
 */
export function RequireAuth({ children }) {
  const { isAuthenticated, isRestoring, needsOnboarding } = useAuth();
  const location = useLocation();

  // La reprise est en vol : rediriger maintenant enverrait à l'écran de
  // connexion quelqu'un qui a une session valide, pour l'en faire revenir une
  // seconde plus tard. Chaque rechargement d'une page profonde traversait donc
  // l'écran de connexion, visiblement, et perdait l'état des composants au
  // passage.
  if (isRestoring) return <RepriseDeSession />;

  if (!isAuthenticated) {
    // La chaîne de requête fait partie de la destination : sans elle, un lien
    // profond comme /app/aide?article=ha-11 perdrait son article après connexion.
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/connexion" replace state={{ from }} />;
  }
  if (needsOnboarding && location.pathname !== '/bienvenue') {
    return <Navigate to="/bienvenue" replace />;
  }
  return children;
}


/** Garde de l'espace d'administration : session distincte de celle de /app. */
export function RequireAdmin({ children }) {
  const { isAuthenticated, isRestoring } = useAdminSession();
  const location = useLocation();

  if (isRestoring) return <RepriseDeSession />;

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/admin/connexion" replace state={{ from }} />;
  }
  return children;
}

/**
 * Garde de permission. L'écran refusé est expliqué plutôt que redirigé en
 * silence : l'administrateur doit savoir quelle permission lui manque.
 */
function RequirePermission({ permission, children }) {
  const { peut } = usePermission();
  return peut(permission) ? children : <PermissionDenied permission={permission} />;
}

const routes = [
  // La racine ne sert plus la vitrine : chacun arrive sur le tableau de bord de
  // sa session, et un visiteur sur l'écran de connexion. Traverser une page de
  // présentation pour atteindre son travail n'a de sens qu'une seule fois.
  { path: '/', element: <RootRedirect /> },
  {
    element: <PublicLayout />,
    children: [
      // La vitrine garde une adresse propre : elle décrit le produit, et cet
      // usage-là survit à la redirection de la racine.
      { path: '/presentation', element: <LandingPage /> },
      { path: '/mentions-legales', element: <LegalPage /> },
      { path: '/invitation/:token', element: <InvitationPage /> },
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: '/connexion', element: <LoginPage /> },
      { path: '/mot-de-passe-oublie', element: <ForgotPasswordPage /> },
      {
        path: '/bienvenue',
        element: (
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        ),
      },
    ],
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },

      {
        path: 'reservation',
        element: <WizardLayout />,
        children: [
          { path: 'besoin', element: <NeedFormPage /> },
          { path: 'salles', element: <EligibleRoomsPage /> },
          { path: 'salles/:roomId', element: <RoomAvailabilityPage /> },
          { path: 'conflit', element: <ConflictPage /> },
          { path: 'recurrente', element: <RecurringBookingPage /> },
          { path: 'acces-exceptionnel', element: <ExceptionalAccessPage /> },
          { path: 'recapitulatif', element: <SummaryPage /> },
        ],
      },
      { path: 'reservation/:id/confirmee', element: <ConfirmedPage /> },

      { path: 'reservations', element: <MyBookingsListPage /> },
      { path: 'reservations/calendrier', element: <MyBookingsCalendarPage /> },
      { path: 'reservations/:id', element: <BookingDetailPage /> },
      { path: 'reservations/:id/modifier', element: <EditBookingPage /> },

      { path: 'salles', element: <ExploreRoomsPage /> },
      { path: 'salles/:id', element: <RoomDetailPage /> },
      { path: 'plan', element: <FloorPlanPage /> },
      // Sans identifiant : l'onglet mobile n'en a aucun à donner.
      { path: 'check-in', element: <CheckInEntryPage /> },
      { path: 'check-in/:id', element: <CheckInPage /> },

      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'profil', element: <ProfilePage /> },
      { path: 'aide', element: <HelpCenterPage /> },
      { path: 'statistiques', element: <StatsPage /> },
      { path: 'recherche', element: <GlobalSearchPage /> },
    ],
  },
  { path: '/admin/connexion', element: <AdminLoginPage /> },
  {
    path: '/admin',
    element: (
      <RequireAdmin>
        <AdminLayout />
      </RequireAdmin>
    ),
    children: [
      { index: true, element: <OccupancyDashboardPage /> },
      {
        path: 'rapports',
        element: (
          <RequirePermission permission="data.export">
            <ReportsPage />
          </RequirePermission>
        ),
      },
      { path: 'reservations', element: <AllBookingsPage /> },
      {
        path: 'conflits',
        element: (
          <RequirePermission permission="conflicts.arbitrate">
            <ConflictQueuePage />
          </RequirePermission>
        ),
      },
      {
        path: 'batiments',
        element: (
          <RequirePermission permission="rooms.manage">
            <BuildingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'salles',
        element: (
          <RequirePermission permission="rooms.manage">
            <RoomsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'salles/:id',
        element: (
          <RequirePermission permission="rooms.manage">
            <RoomEditPage />
          </RequirePermission>
        ),
      },
      {
        path: 'equipements',
        element: (
          <RequirePermission permission="rooms.manage">
            <EquipmentPage />
          </RequirePermission>
        ),
      },
      {
        path: 'plans',
        element: (
          <RequirePermission permission="rooms.manage">
            <PlansPage />
          </RequirePermission>
        ),
      },
      {
        path: 'ouvertures',
        element: (
          <RequirePermission permission="rules.configure">
            <SchedulesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'regles',
        element: (
          <RequirePermission permission="rules.configure">
            <BookingRulesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'utilisateurs',
        element: (
          <RequirePermission permission="users.manage">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'roles',
        element: (
          <RequirePermission permission="system.configure">
            <RolesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'tickets',
        element: (
          <RequirePermission permission="support.handle">
            <TicketsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'tickets/:id',
        element: (
          <RequirePermission permission="support.handle">
            <TicketsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'connaissances',
        element: (
          <RequirePermission permission="support.handle">
            <KnowledgePage />
          </RequirePermission>
        ),
      },
      {
        path: 'modeles',
        element: (
          <RequirePermission permission="system.configure">
            <EmailTemplatesPage />
          </RequirePermission>
        ),
      },
      {
        // Sans permission : régler son propre compte n'est pas un droit
        // d'administration, c'est ce que tout titulaire de compte peut faire.
        path: 'profil',
        element: <AdminProfilePage />,
      },
      {
        path: 'audit',
        element: (
          <RequirePermission permission="system.configure">
            <AuditLogPage />
          </RequirePermission>
        ),
      },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes, {
  // Comportements de la version 7 activés dès maintenant. Ils ne changent rien
  // au fonctionnement observable ici, mais un avertissement permanent en
  // console finit par masquer les vrais.
  //
  // `v7_startTransition` n'est pas ici : il se déclare sur `RouterProvider`,
  // pas sur le routeur. Le poser à cet endroit ne produit aucune erreur — et
  // l'avertissement continue de s'afficher, ce qui est le pire des cas.
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
});
