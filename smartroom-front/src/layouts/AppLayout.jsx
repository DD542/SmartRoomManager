import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { MobileNav } from '../components/layout/MobileNav';
import { NavDrawer } from '../components/layout/NavDrawer';
import { PageTransition } from '../components/layout/PageTransition';
import { ChatbotPanel } from '../components/support/ChatbotPanel';

/**
 * Cadre de l'espace connecté : barre latérale (≥768 px), barre haute, contenu,
 * barre d'onglets basse et tiroir secondaire (<768 px), assistant SmartBot.
 *
 * L'ordre des enfants est aussi l'ordre de tabulation : lien d'évitement,
 * navigation, contenu. Le tiroir est monté en dernier — il s'ouvre par-dessus
 * et rend le focus à son bouton en se fermant.
 */
export default function AppLayout() {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const { pathname } = useLocation();

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
        <MobileNav onOpenMore={() => setMenuOuvert(true)} moreOpen={menuOuvert} />
      </div>

      {/* `key` sur le chemin : l'état actif des liens est calculé au rendu, et
          sans cela le tiroir rouvert garderait la surbrillance de l'écran
          quitté — le même défaut que le tiroir de l'administration avait. */}
      <NavDrawer key={pathname} open={menuOuvert} onClose={() => setMenuOuvert(false)} />

      <ChatbotPanel />
    </div>
  );
}
