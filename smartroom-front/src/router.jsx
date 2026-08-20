import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';

import PublicLayout from './layouts/PublicLayout';
import AuthLayout from './layouts/AuthLayout';
import AppLayout from './layouts/AppLayout';
import WizardLayout from './layouts/WizardLayout';

import LandingPage from './pages/public/LandingPage';
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
import NotificationsPage from './pages/account/NotificationsPage';
import ProfilePage from './pages/account/ProfilePage';
import HelpCenterPage from './pages/account/HelpCenterPage';
import StatsPage from './pages/account/StatsPage';
import GlobalSearchPage from './pages/system/GlobalSearchPage';
import NotFoundPage from './pages/system/NotFoundPage';
import ForbiddenPage from './pages/system/ForbiddenPage';

/** Garde d'authentification : mémorise l'URL demandée pour y revenir après connexion. */
function RequireAuth({ children }) {
  const { isAuthenticated, needsOnboarding } = useAuth();
  const location = useLocation();

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

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
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
      { path: 'check-in/:id', element: <CheckInPage /> },

      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'profil', element: <ProfilePage /> },
      { path: 'aide', element: <HelpCenterPage /> },
      { path: 'statistiques', element: <StatsPage /> },
      { path: 'recherche', element: <GlobalSearchPage /> },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
