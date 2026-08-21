import { Outlet } from 'react-router-dom';
import { AdminSidebar } from '../components/admin/AdminSidebar';
import { AdminTopbar } from '../components/admin/AdminTopbar';

/**
 * Cadre de l'espace d'administration : sidebar groupée par domaine, barre haute
 * avec la file d'arbitrage, contenu large. La navigation mobile de l'espace
 * utilisateur n'est pas reprise : ces écrans sont denses et pensés pour un poste
 * de travail, avec une dégradation propre plutôt qu'une barre d'onglets.
 */
export default function AdminLayout() {
  return (
    <div className="flex h-full min-h-screen bg-ink">
      <a href="#contenu-admin" className="sr-skip">
        Aller au contenu principal
      </a>
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <main id="contenu-admin" tabIndex={-1} className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
