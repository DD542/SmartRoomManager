import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * Recherche de la barre haute.
 *
 * Au-delà de 768 px, un champ posé dans la barre : il y a la place, et taper
 * directement est le geste le plus court.
 *
 * En dessous, un bouton qui ouvre une boîte de dialogue. Le champ y occupe
 * toute la largeur, avec un bouton « Rechercher ». Trois raisons, mesurées sur
 * l'écran d'administration au téléphone : le champ inséré entre le menu et
 * quatre icônes tombait à une centaine de pixels — deux caractères visibles ;
 * la liste de suggestions, ancrée sur ce champ étroit, débordait de l'écran ;
 * et le clavier virtuel recouvrait le résultat qu'il fallait lire.
 *
 * Le champ n'existe qu'une fois à la fois : deux `<input>` portant le même
 * `id`, l'un masqué par une classe, casseraient l'association avec le libellé
 * et le lecteur d'écran annoncerait le mauvais.
 */
export function BarreRecherche({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  className = 'md:max-w-md',
}) {
  const compact = useIsMobile();
  const [ouverte, setOuverte] = useState(false);
  const champ = useRef(null);

  useEffect(() => {
    // Le piège de focus place le focus sur la boîte ; on le rend au champ,
    // qui est la seule raison d'avoir ouvert cette boîte.
    if (ouverte) champ.current?.focus();
  }, [ouverte]);

  const envoyer = (event) => {
    onSubmit(event);
    setOuverte(false);
  };

  if (compact) {
    return (
      <>
        {/* Le mot « Rechercher » disparaît sous 640 px. Mesure à l'appui :
            avec lui, « Menu » et quatre icônes, la barre réclamait 395 px pour
            un écran de 375 — et c'est la page entière qui s'élargissait, donc
            tout l'espace d'administration qui sortait par la droite. Le
            libellé reste lu par les lecteurs d'écran. */}
        <button
          type="button"
          onClick={() => setOuverte(true)}
          className="pression inline-flex min-h-[40px] w-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-content/[0.05] text-sm text-content-faint transition-colors hover:bg-content/[0.08] sm:w-auto sm:justify-start sm:px-3.5"
        >
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{label}</span>
          <span aria-hidden="true" className="hidden sm:inline">
            Rechercher
          </span>
        </button>

        <Modal
          open={ouverte}
          onClose={() => setOuverte(false)}
          icon={Search}
          title={label}
          size="md"
        >
          <form role="search" onSubmit={envoyer} className="flex flex-col gap-3">
            <label htmlFor={`${id}-compact`} className="sr-only">
              {label}
            </label>
            <input
              ref={champ}
              id={`${id}-compact`}
              type="search"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="h-12 w-full rounded-full border border-line/70 bg-surface/70 px-4 text-base text-content placeholder:text-content-faint focus:border-content/40 focus:outline-none focus:ring-4 focus:ring-content/[0.08]"
            />
            {/* `type="submit"` : la touche Entrée du clavier virtuel doit
                lancer la recherche comme le bouton. */}
            <Button type="submit" icon={Search} fullWidth disabled={value.trim().length < 2}>
              Rechercher
            </Button>
            <p className="text-xs text-content-faint">Deux caractères au minimum.</p>
          </form>
        </Modal>
      </>
    );
  }

  return (
    <form role="search" onSubmit={onSubmit} className={`relative min-w-0 flex-1 ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-faint"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-full border border-transparent bg-content/[0.05] pl-10 pr-4 text-sm text-content placeholder:text-content-faint transition focus:border-content/20 focus:bg-surface/80 focus:outline-none focus:ring-4 focus:ring-content/[0.06]"
      />
    </form>
  );
}
