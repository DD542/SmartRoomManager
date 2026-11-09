import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { listBuildings } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';

/**
 * Bandeau d'ouverture de l'accueil : la façade d'un bâtiment en fond, la
 * salutation, et la barre de recherche de verre posée dessus.
 *
 * La photo est celle du bâtiment préféré de l'utilisateur, à défaut la
 * première disponible : l'accueil montre un lieu qu'il connaît. Sans aucune
 * photo, le bandeau garde sa brume et reste lisible — l'image n'est qu'un
 * décor, jamais le porteur d'une information.
 *
 * Le dégradé part de la couleur du fond de page : le texte se pose sur de la
 * brume claire en thème clair, sur du graphite en thème sombre, et l'image
 * se dévoile vers la droite.
 */
export function HeroAccueil({ prenom, batimentPrefere, action }) {
  const navigate = useNavigate();
  const [requete, setRequete] = useState('');
  const batiments = useAsync(() => listBuildings(), []);

  const liste = batiments.data ?? [];
  const photo =
    liste.find((b) => b.id === batimentPrefere && b.imageUrl)?.imageUrl ??
    liste.find((b) => b.imageUrl)?.imageUrl ??
    null;

  const envoyer = (event) => {
    event.preventDefault();
    const texte = requete.trim();
    if (texte.length >= 2) navigate(`/app/recherche?q=${encodeURIComponent(texte)}`);
    else navigate('/app/salles');
  };

  return (
    <section
      aria-label="Bienvenue"
      className="relative isolate overflow-hidden rounded-3xl shadow-haute"
    >
      {photo && (
        <img
          src={photo}
          alt=""
          className="absolute inset-0 -z-10 h-full w-full animate-[apparition-photo_1.6s_cubic-bezier(0.16,1,0.3,1)_both] object-cover"
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/75 to-ink/0"
      />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-ink/70 to-transparent" />

      <div className="flex min-h-[260px] flex-col justify-between gap-8 px-6 py-7 md:min-h-[300px] md:px-9 md:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <h1 className="animate-fade-in-up font-display text-3xl font-normal tracking-tight text-content md:text-[40px] md:leading-[1.1]">
              Bonjour, <span className="font-extrabold italic">{prenom}</span>{' '}
              <span
                aria-hidden="true"
                className="inline-block origin-[70%_70%] animate-[salut_1.8s_ease-in-out_0.6s_both]"
              >
                👋
              </span>
            </h1>
            <p className="mt-2 animate-fade-in-up text-[15px] leading-relaxed text-content-muted [animation-delay:80ms]">
              Réservez, gérez et optimisez vos espaces en toute simplicité.
            </p>
          </div>
          {/* Au bureau, la barre latérale porte déjà l'action : la répéter dans
              le bandeau ferait deux boutons identiques à l'écran. */}
          {action && <div className="animate-fade-in-up [animation-delay:120ms] md:hidden">{action}</div>}
        </div>

        <form
          role="search"
          onSubmit={envoyer}
          className="verre-epais flex w-full max-w-2xl animate-fade-in-up items-center gap-2 rounded-full py-1.5 pl-5 pr-1.5 [animation-delay:160ms]"
        >
          <Search size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
          <label htmlFor="recherche-accueil" className="sr-only">
            Rechercher une salle, un bâtiment, un équipement
          </label>
          <input
            id="recherche-accueil"
            type="search"
            value={requete}
            onChange={(event) => setRequete(event.target.value)}
            placeholder="Rechercher une salle, un bâtiment, un équipement…"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-content placeholder:text-content-faint focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Lancer la recherche"
            className="pression flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-ink shadow-bouton transition-colors hover:bg-accent-hover"
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}
