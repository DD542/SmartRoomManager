import { Link, Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '../components/brand/Logo';
import { cn } from '../utils/cn';

/**
 * Cadre des écrans publics d'authentification : logo centré, carte, liens de pied.
 * L'onboarding réclame une colonne plus large que les formulaires de connexion.
 */
export default function AuthLayout() {
  const { pathname } = useLocation();
  const wide = pathname.startsWith('/bienvenue');

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Monogramme et nom centrés, comme l'écran d'accueil de l'application
          mobile de la maquette. Il descend en faisant le point. */}
      <header className="mb-8 flex animate-fade-in-up flex-col items-center gap-3 text-center">
        {/* Le logo ramène à la présentation, comme sur les autres pages
            publiques : sans lien, l'écran de connexion était un cul-de-sac. */}
        <Link
          to="/presentation"
          aria-label="SmartRoom Manager, retour à la présentation"
          className="pression flex flex-col items-center gap-3 rounded-2xl"
        >
          <span className="text-content">
            <LogoMark size={52} />
          </span>
          <span className="font-display text-3xl font-semibold leading-tight tracking-tight text-content">
            SmartRoom Manager
          </span>
        </Link>
        <p className="text-sm text-content-muted">Réservez. Gérez. Collaborez.</p>
      </header>

      <main className={cn('w-full animate-fade-in-up [animation-delay:80ms]', wide ? 'max-w-2xl' : 'max-w-md')}>
        <Outlet />
      </main>

      <footer className="mt-8 flex items-center gap-3 text-xs text-content-muted">
        <Link to="/app/aide" className="rounded-full px-2 py-1 transition hover:text-content">
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
