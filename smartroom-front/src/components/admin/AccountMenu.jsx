import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, ShieldCheck, UserCog } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAdminSession } from '../../hooks/useAdminSession';
import { Avatar } from '../ui/Avatar';

/**
 * Menu du compte, ouvert depuis l'avatar de la barre haute.
 *
 * Un menu et non un lien : l'avatar est le seul point de la barre qui parle du
 * compte lui-même, et y accrocher une seule destination obligerait à ouvrir un
 * écran pour se déconnecter.
 *
 * L'accessibilité tient à quatre choses, toutes indispensables et aucune
 * fournie par défaut : le déclencheur annonce l'état du menu (`aria-expanded`)
 * et ce qu'il commande (`aria-haspopup`) ; Échap referme et rend le focus au
 * déclencheur, sans quoi la navigation au clavier se perdrait dans la page ;
 * un clic au-dehors referme, comme tout menu ; et les entrées sont des
 * `menuitem` dans un conteneur `menu`, pour qu'un lecteur d'écran annonce
 * « 1 sur 4 » plutôt qu'une liste de liens sans rapport entre eux.
 */
export function AccountMenu({ onLogout }) {
  const navigate = useNavigate();
  const { admin } = useAdminSession();
  const [ouvert, setOuvert] = useState(false);
  const conteneur = useRef(null);
  const declencheur = useRef(null);
  const identifiant = useId();

  const nom = admin ? `${admin.firstName} ${admin.lastName}` : 'Administration';

  const fermer = ({ rendreLeFocus = false } = {}) => {
    setOuvert(false);
    if (rendreLeFocus) declencheur.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return undefined;

    const surClic = (event) => {
      if (!conteneur.current?.contains(event.target)) setOuvert(false);
    };
    const surTouche = (event) => {
      if (event.key === 'Escape') fermer({ rendreLeFocus: true });
    };

    document.addEventListener('mousedown', surClic);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert]);

  const aller = (chemin) => {
    fermer();
    navigate(chemin);
  };

  return (
    <div ref={conteneur} className="relative">
      <button
        ref={declencheur}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? identifiant : undefined}
        onClick={() => setOuvert((etat) => !etat)}
        className="flex items-center gap-2 rounded-full p-0.5 transition hover:bg-surface-raised"
      >
        <Avatar name={nom} src={admin?.avatarUrl} />
        <span className="sr-only">Mon compte — {nom}</span>
      </button>

      {ouvert && (
        <div
          id={identifiant}
          role="menu"
          aria-label="Mon compte"
          className="absolute right-0 top-full z-sticky mt-2 w-64 animate-scale-in overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-line px-3 py-3">
            <Avatar name={nom} src={admin?.avatarUrl} size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-content">{nom}</span>
              <span className="block truncate text-xs text-content-muted">{admin?.email}</span>
              {admin?.isOwner && (
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-bright">
                  <ShieldCheck size={11} aria-hidden="true" />
                  Propriétaire
                </span>
              )}
            </span>
          </div>

          <div className="py-1">
            <Entree icon={UserCog} onClick={() => aller('/admin/profil')}>
              Mon profil et ma photo
            </Entree>
            <Entree icon={ArrowLeft} onClick={() => aller('/app')}>
              Retour à l’espace utilisateur
            </Entree>
          </div>

          <div className="border-t border-line py-1">
            <Entree
              icon={LogOut}
              tone="danger"
              onClick={() => {
                fermer();
                onLogout?.();
              }}
            >
              Déconnexion
            </Entree>
          </div>
        </div>
      )}
    </div>
  );
}

function Entree({ icon: Icone, children, onClick, tone }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
        tone === 'danger'
          ? 'text-content-muted hover:bg-danger-soft hover:text-danger'
          : 'text-content-muted hover:bg-surface-raised hover:text-content',
      )}
    >
      <Icone size={15} aria-hidden="true" />
      {children}
    </button>
  );
}
