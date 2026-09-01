import { Link, Outlet, useLocation } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { cn } from '../utils/cn';

/**
 * Cadre des écrans publics d'authentification : logo centré, carte, liens de pied.
 * L'onboarding réclame une colonne plus large que les formulaires de connexion.
 */
export default function AuthLayout() {
  const { pathname } = useLocation();
  const wide = pathname.startsWith('/bienvenue');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-4 py-10">
      <header className="mb-8 flex flex-col items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
          <DoorOpen size={22} aria-hidden="true" className="text-accent" />
        </span>
        <p className="text-2xl font-semibold tracking-tight">
          <span className="text-accent">SmartRoom</span> <span className="text-content">Manager</span>
        </p>
      </header>

      <main className={cn('w-full', wide ? 'max-w-2xl' : 'max-w-md')}>
        <Outlet />
      </main>

      <footer className="mt-8 flex items-center gap-3 text-xs text-content-muted">
        <Link to="/app/aide" className="transition hover:text-content">
          Besoin d’aide ?
        </Link>
        <span aria-hidden="true">•</span>
        <Link to="/mentions-legales" className="transition hover:text-content">
          Mentions légales
        </Link>
      </footer>
    </div>
  );
}
