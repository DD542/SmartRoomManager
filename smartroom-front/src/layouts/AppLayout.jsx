import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { MobileNav } from '../components/layout/MobileNav';
import { NavDrawer } from '../components/layout/NavDrawer';
import { PageTransition } from '../components/layout/PageTransition';
import { ChatbotPanel } from '../components/support/ChatbotPanel';

/**
 * Cadre de l'espace connecté : barre latérale flottante (≥768 px), barre
 * haute de verre, contenu, barre d'onglets flottante et tiroir secondaire
 * (<768 px), assistant SmartBot.
 *
 * La page défile d'un bloc (et non une colonne interne) : c'est ce qui laisse
 * le contenu glisser sous la barre haute et la barre d'onglets, et
 * transparaître à travers leur verre.
 *
 * L'ordre des enfants est aussi l'ordre de tabulation : lien d'évitement,
 * navigation, contenu. Le tiroir est monté en dernier — il s'ouvre par-dessus
 * et rend le focus à son bouton en se fermant.
 */
export default function AppLayout() {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen">
      <a href="#contenu" className="sr-skip">
        Aller au contenu principal
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* Marge basse sous 768 px : la barre d'onglets flotte au-dessus du
            contenu, la dernière carte ne doit pas finir cachée dessous. */}
        <main
          id="contenu"
          tabIndex={-1}
          className="flex-1 px-4 pb-32 pt-2 md:px-6 md:pb-10 md:pt-3 lg:px-8"
        >
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
