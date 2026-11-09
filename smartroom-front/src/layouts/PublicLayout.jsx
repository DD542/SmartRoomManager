import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { BasculeTheme } from '../components/layout/BasculeTheme';
import { Logo } from '../components/brand/Logo';
import { cn } from '../utils/cn';

const LINKS = [
  { href: '#demo', label: 'Démo' },
  { href: '#fonctionnalites', label: 'Fonctionnalités' },
  { href: '#fonctionnement', label: 'Comment ça marche' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * Vrai dès que la page a quitté le haut.
 *
 * L'écoute est passive : le navigateur n'a pas à attendre le gestionnaire pour
 * défiler, et le défilement reste fluide au doigt. Seul le franchissement du
 * seuil provoque un rendu — comparer avant d'écrire évite un rendu par pixel
 * parcouru.
 */
function useDefilee(seuil = 8) {
  const [defilee, setDefilee] = useState(false);

  useEffect(() => {
    const mesurer = () => setDefilee((etat) => {
      const passe = window.scrollY > seuil;
      return passe === etat ? etat : passe;
    });

    mesurer();
    window.addEventListener('scroll', mesurer, { passive: true });
    return () => window.removeEventListener('scroll', mesurer);
  }, [seuil]);

  return defilee;
}

/** Cadre des pages publiques : en-tête de site, contenu, pied de page. */
export default function PublicLayout() {
  const defilee = useDefilee();

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="sr-skip">
        Aller au contenu principal
      </a>

      {/* En haut de page, l'en-tête occupe toute la largeur et se fond dans le
          bandeau d'ouverture ; dès que le contenu passe dessous, il se
          resserre en une pilule de verre flottante — le geste des barres
          d'outils de Safari. Sans fond, le texte défilant viendrait buter
          dans les liens. */}
      <header className="sticky top-0 z-topbar px-3 pt-3">
        <div
          className={cn(
            'mx-auto flex h-14 w-full items-center justify-between gap-4 rounded-full px-3 transition-all duration-700 ease-feuille',
            defilee ? 'verre max-w-4xl shadow-haute' : 'max-w-6xl',
          )}
        >
          <Link to="/" aria-label="SmartRoom Manager, accueil" className="pression flex items-center gap-2 pl-1">
            <Logo size={26} className="[&>span]:text-[13px]" />
          </Link>
          <nav aria-label="Navigation du site" className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="pression rounded-full px-3.5 py-1.5 text-sm text-content-muted transition-colors hover:bg-content/[0.06] hover:text-content"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <BasculeTheme />
            <Button to="/connexion" size="sm">
              Se connecter
            </Button>
          </div>
        </div>
      </header>

      <main id="contenu" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="verre mx-3 mb-3 rounded-3xl">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 text-xs text-content-muted sm:grid-cols-2 md:grid-cols-4">
          <div>
            <Logo size={26} />
            <p className="mt-2 leading-relaxed">
              Réservation intelligente des salles : disponibilités en temps réel, détection des
              conflits et recommandation automatique.
            </p>
          </div>
          <div>
            <p className="font-medium tracking-tight text-content">Produit</p>
            <ul className="mt-2 space-y-1.5">
              <li>Fonctionnalités</li>
              <li>Calendrier</li>
              <li>Statistiques</li>
            </ul>
          </div>
          <div>
            <p className="font-medium tracking-tight text-content">Support</p>
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
            <p className="font-medium tracking-tight text-content">Légal</p>
            {/* Trois libellés, une seule page : confidentialité, mentions et
                RGPD y sont trois sections. Les annoncer séparément pour mener
                au même endroit vaut mieux que trois pages qui se répètent —
                mais ils mènent quelque part, ce qui n'était pas le cas. */}
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to="/mentions-legales" className="transition hover:text-content">
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link to="/mentions-legales" className="transition hover:text-content">
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link to="/mentions-legales" className="transition hover:text-content">
                  RGPD
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="px-4 pb-6 text-center text-xs text-content-faint">
          © 2026 SmartRoom Manager. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
