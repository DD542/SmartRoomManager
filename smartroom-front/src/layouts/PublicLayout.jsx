import { Link, Outlet } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { Button } from '../components/ui/Button';

const LINKS = [
  { href: '#fonctionnalites', label: 'Fonctionnalités' },
  { href: '#fonctionnement', label: 'Comment ça marche' },
  { href: '#faq', label: 'FAQ' },
];

/** Cadre des pages publiques : en-tête de site, contenu, pied de page. */
export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <a href="#contenu" className="sr-skip">
        Aller au contenu principal
      </a>

      <header className="sticky top-0 z-40 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-content">
            <DoorOpen size={18} aria-hidden="true" className="text-accent" />
            SmartRoom Manager
          </Link>
          <nav aria-label="Navigation du site" className="hidden items-center gap-5 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-content-muted transition hover:text-content"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <Button to="/connexion" size="sm">
            Se connecter
          </Button>
        </div>
      </header>

      <main id="contenu" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-surface">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 text-xs text-content-muted sm:grid-cols-2 md:grid-cols-4">
          <div>
            <p className="text-sm font-semibold text-content">SmartRoom Manager</p>
            <p className="mt-2 leading-relaxed">
              Réservation intelligente des salles : disponibilités en temps réel, détection des
              conflits et recommandation automatique.
            </p>
          </div>
          <div>
            <p className="font-medium uppercase tracking-wide text-content">Produit</p>
            <ul className="mt-2 space-y-1.5">
              <li>Fonctionnalités</li>
              <li>Calendrier</li>
              <li>Statistiques</li>
            </ul>
          </div>
          <div>
            <p className="font-medium uppercase tracking-wide text-content">Support</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to="/app/aide" className="transition hover:text-content">
                  Centre d’aide
                </Link>
              </li>
              <li>Contact</li>
            </ul>
          </div>
          <div>
            <p className="font-medium uppercase tracking-wide text-content">Légal</p>
            <ul className="mt-2 space-y-1.5">
              <li>Confidentialité</li>
              <li>Mentions légales</li>
              <li>RGPD</li>
            </ul>
          </div>
        </div>
        <p className="px-4 pb-6 text-center text-xs text-content-faint">
          © 2026 SmartRoom Manager — Projet académique ECE Paris.
        </p>
      </footer>
    </div>
  );
}
