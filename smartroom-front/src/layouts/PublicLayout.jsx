import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { BasculeTheme } from '../components/layout/BasculeTheme';
import { Logo } from '../components/brand/Logo';
import { cn } from '../utils/cn';

/** Page d'accueil publique : celle du logo, et celle qui porte les sections. */
export const PRESENTATION = '/presentation';

const LINKS = [
  { ancre: 'demo', label: 'Démo' },
  { ancre: 'fonctionnalites', label: 'Fonctionnalités' },
  { ancre: 'fonctionnement', label: 'Comment ça marche' },
  { ancre: 'faq', label: 'FAQ' },
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
  const { pathname } = useLocation();
  // Sur la présentation, une ancre suffit ; ailleurs (mentions légales), elle
  // ne menait nulle part : le lien rejoint la section sur la présentation.
  const surPresentation = pathname === PRESENTATION;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="sr-skip">
        Aller au contenu principal
      </a>

      {/* Barre marine flottante, comme celle de MentorGoal : toujours
          lisible sur le halo du bandeau. Elle se resserre d'un cran quand le
          contenu passe dessous, avec la courbe des feuilles d'iOS. Le marine
          est fixé et non tiré du thème : la barre reste la signature de la
          marque, en clair comme en sombre. */}
      <header className="sticky top-0 z-topbar px-3 pt-3">
        <div
          className={cn(
            'mx-auto flex h-16 w-full items-center justify-between gap-4 rounded-[22px] bg-[#263171] px-4 text-white ring-1 ring-white/10 transition-all duration-700 ease-feuille',
            defilee
              ? 'max-w-5xl shadow-[0_18px_40px_-18px_rgb(12_21_71/0.65)]'
              : 'max-w-6xl shadow-[0_10px_30px_-18px_rgb(12_21_71/0.5)]',
          )}
        >
          {/* La présentation et non `/` : la racine renvoie à l'écran de
              connexion quiconque n'a pas de session, et le logo des mentions
              légales y menait au lieu de ramener à l'accueil du site. */}
          <Link to={PRESENTATION} aria-label="SmartRoom Manager, accueil" className="pression flex items-center gap-2 pl-1">
            <Logo inverse size={26} className="[&>span]:text-[13px]" />
          </Link>
          <nav aria-label="Navigation du site" className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) =>
              surPresentation ? (
                <a
                  key={link.ancre}
                  href={`#${link.ancre}`}
                  className="pression rounded-full px-3.5 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.ancre}
                  to={`${PRESENTATION}#${link.ancre}`}
                  className="pression rounded-full px-3.5 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
          <div className="flex items-center gap-1.5">
            <BasculeTheme variant="ghost-marine" />
            <Button to="/connexion" size="sm" variant="corail" iconRight={ArrowRight} className="pl-4">
              Se connecter
            </Button>
          </div>
        </div>
      </header>

      <main id="contenu" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="mx-3 mb-3 rounded-[28px] bg-[#263171] text-white">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 text-xs text-white/75 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <Logo inverse size={26} />
            <p className="mt-2 leading-relaxed">
              Réservation intelligente des salles : disponibilités en temps réel, détection des
              conflits et recommandation automatique.
            </p>
          </div>
          <div>
            <p className="font-medium tracking-tight text-white">Produit</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to={`${PRESENTATION}#fonctionnalites`} className="transition hover:text-white">
                  Fonctionnalités
                </Link>
              </li>
              <li>
                <Link to={`${PRESENTATION}#demo`} className="transition hover:text-white">
                  Démonstration
                </Link>
              </li>
              <li>
                <Link to={`${PRESENTATION}#faq`} className="transition hover:text-white">
                  Questions fréquentes
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium tracking-tight text-white">Support</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to="/app/aide" className="transition hover:text-white">
                  Centre d’aide
                </Link>
              </li>
              <li>Contact</li>
            </ul>
          </div>
          <div>
            <p className="font-medium tracking-tight text-white">Légal</p>
            {/* Trois libellés, une seule page : confidentialité, mentions et
                RGPD y sont trois sections. Les annoncer séparément pour mener
                au même endroit vaut mieux que trois pages qui se répètent —
                mais ils mènent quelque part, ce qui n'était pas le cas. */}
            <ul className="mt-2 space-y-1.5">
              <li>
                <Link to="/mentions-legales" className="transition hover:text-white">
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link to="/mentions-legales" className="transition hover:text-white">
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link to="/mentions-legales" className="transition hover:text-white">
                  RGPD
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="px-4 pb-6 text-center text-xs text-white/60">
          © 2026 SmartRoom Manager. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
