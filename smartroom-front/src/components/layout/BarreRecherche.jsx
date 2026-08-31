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
        <button
          type="button"
          onClick={() => setOuverte(true)}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 text-sm text-content-faint transition hover:border-line-strong"
        >
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{label}</span>
          <span aria-hidden="true">Rechercher</span>
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
              className="h-11 w-full rounded-xl border border-line bg-surface-raised px-3 text-base text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
      />
    </form>
  );
}
