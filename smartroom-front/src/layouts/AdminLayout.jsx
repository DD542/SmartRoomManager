import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminNav, AdminSidebar } from '../components/admin/AdminSidebar';
import { AdminTopbar } from '../components/admin/AdminTopbar';
import { BottomSheet } from '../components/ui/Modal';

/**
 * Cadre de l'espace d'administration : barre latérale groupée par domaine,
 * barre haute avec la file d'arbitrage, contenu large.
 *
 * Sous 768 px la barre latérale cède la place à une feuille ouverte depuis la
 * barre haute. Ces écrans restent pensés pour un poste de travail, mais une
 * dégradation qui supprime toute navigation n'est pas une dégradation : elle
 * rendait dix-sept écrans sur dix-huit inatteignables au doigt.
 */
export default function AdminLayout() {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="flex h-full min-h-screen bg-ink">
      <a href="#contenu-admin" className="sr-skip">
        Aller au contenu principal
      </a>
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenMenu={() => setMenuOuvert(true)} />
        <main id="contenu-admin" tabIndex={-1} className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomSheet
        open={menuOuvert}
        onClose={() => setMenuOuvert(false)}
        title="Administration"
      >
        {/* `key` sur le chemin : le lien actif est calculé au rendu, et sans
            cela la feuille rouverte garderait la surbrillance de l'écran
            quitté. */}
        <AdminNav key={pathname} onNavigate={() => setMenuOuvert(false)} />
      </BottomSheet>
    </div>
  );
}
