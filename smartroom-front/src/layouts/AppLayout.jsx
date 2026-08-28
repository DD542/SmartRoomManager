import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { MobileNav } from '../components/layout/MobileNav';
import { PageTransition } from '../components/layout/PageTransition';
import { ChatbotPanel } from '../components/support/ChatbotPanel';

/**
 * Cadre de l'espace connecté : sidebar (≥768px), topbar, contenu, barre
 * d'onglets basse (<768px) et assistant SmartBot flottant (U-23).
 */
export default function AppLayout() {
  return (
    <div className="flex h-full min-h-screen bg-ink">
      <a href="#contenu" className="sr-skip">
        Aller au contenu principal
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="contenu" tabIndex={-1} className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
          <PageTransition className="mx-auto w-full max-w-6xl">
            <Outlet />
          </PageTransition>
        </main>
        <MobileNav />
      </div>
      <ChatbotPanel />
    </div>
  );
}
