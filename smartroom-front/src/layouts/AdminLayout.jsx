import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminNav, AdminSidebar } from '../components/admin/AdminSidebar';
import { AdminTopbar } from '../components/admin/AdminTopbar';
import { PageTransition } from '../components/layout/PageTransition';
import { BottomSheet } from '../components/ui/Modal';

/** Clé du réglage d'espace de travail, conservé d'une session à l'autre. */
const CLE_REPLI = 'smartroom.admin.sidebar-repliee';

/** Lecture défensive : un stockage refusé — navigation privée — n'est pas une panne. */
function repliInitial() {
  try {
    return window.localStorage.getItem(CLE_REPLI) === '1';
  } catch {
    return false;
  }
}

/**
 * Cadre de l'espace d'administration : barre latérale groupée par domaine,
 * barre haute avec la file d'arbitrage, contenu large.
 *
 * Sous 768 px la barre latérale cède la place à une feuille ouverte depuis la
 * barre haute. Ces écrans restent pensés pour un poste de travail, mais une
 * dégradation qui supprime toute navigation n'est pas une dégradation : elle
 * rendait dix-sept écrans sur dix-huit inatteignables au doigt.
 *
 * Entre 768 et 1024 px, la barre se replie en colonne d'icônes : ses 240 px y
 * prenaient un quart de la largeur au détriment de tables de dix colonnes.
 */
export default function AdminLayout() {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [reduite, setReduite] = useState(repliInitial);
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      window.localStorage.setItem(CLE_REPLI, reduite ? '1' : '0');
    } catch {
      /* sans effet : le repli reste valable pour la session en cours */
    }
  }, [reduite]);

  return (
    <div className="flex h-full min-h-screen bg-ink">
      <a href="#contenu-admin" className="sr-skip">
        Aller au contenu principal
      </a>
      <AdminSidebar reduit={reduite} onToggle={() => setReduite((courant) => !courant)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenMenu={() => setMenuOuvert(true)} menuOuvert={menuOuvert} />
        <main
          id="contenu-admin"
          tabIndex={-1}
          className="flex-1 overflow-y-auto px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] md:px-6"
        >
          <PageTransition className="mx-auto w-full max-w-7xl">
            <Outlet />
          </PageTransition>
        </main>
      </div>

      <BottomSheet open={menuOuvert} onClose={() => setMenuOuvert(false)} title="Administration">
        {/* `key` sur le chemin : le lien actif est calculé au rendu, et sans
            cela la feuille rouverte garderait la surbrillance de l'écran
            quitté. La recherche de destination y est d'autant plus utile que
            la feuille n'affiche pas dix-huit entrées d'un coup. */}
        <div className="flex flex-col pb-[env(safe-area-inset-bottom)]">
          <AdminNav key={pathname} onNavigate={() => setMenuOuvert(false)} />
        </div>
      </BottomSheet>
    </div>
  );
}
