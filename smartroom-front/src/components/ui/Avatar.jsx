import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn';

const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-20 w-20 text-xl',
};

/**
 * Portrait du compte, ou ses initiales à défaut.
 *
 * L'image reste facultative : un compte sans photo est l'état normal, et les
 * initiales ne sont pas un pis-aller mais la présentation par défaut. Une
 * adresse qui ne charge pas — fichier effacé, cache périmé — y ramène aussi,
 * plutôt que de laisser le cadre vide de l'image cassée du navigateur.
 */
export function Avatar({ name = '', src = null, size = 'md', className, tone }) {
  const [echouee, setEchouee] = useState(false);
  // Une nouvelle adresse mérite une nouvelle tentative : sans cela, un dépôt
  // réussi après un échec resterait masqué jusqu'au rechargement de la page.
  useEffect(() => setEchouee(false), [src]);

  const parts = name.trim().split(' ');
  const letters = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '?';

  if (src && !echouee) {
    return (
      <img
        src={src}
        alt={name || 'Photo de profil'}
        onError={() => setEchouee(true)}
        className={cn(
          'inline-block shrink-0 rounded-full border border-line object-cover',
          SIZES[size] ?? SIZES.md,
          className,
        )}
      />
    );
  }
  // Les initiales sont en `text-content` et non dans la teinte du fond :
  // `text-accent` sur `bg-accent-soft` ne donnait que 4,26:1 en taille `sm`
  // (10 px), sous le seuil AA. La teinte du fond suffit à distinguer les
  // pastilles entre elles, et la lettre redevient lisible.
  const tones = ['bg-accent-soft', 'bg-success-soft', 'bg-warning-soft'];
  const picked = tone ?? tones[letters.charCodeAt(0) % tones.length];

  return (
    <span
      role="img"
      aria-label={name || 'Utilisateur'}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-line font-medium text-content',
        SIZES[size] ?? SIZES.md,
        picked,
        className,
      )}
    >
      {letters}
    </span>
  );
}

/** Groupe d'avatars superposés, avec compteur de débordement. */
export function AvatarGroup({ people = [], max = 4, size = 'sm', className }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-2">
        {shown.map((person) => (
          <Avatar
            key={person.email ?? person.name}
            name={person.name}
            size={size}
            className="ring-2 ring-surface"
          />
        ))}
      </div>
      {rest > 0 && (
        <span className="ml-2 rounded-full border border-line bg-surface-raised px-2 py-0.5 text-xs text-content-muted">
          +{rest}
        </span>
      )}
    </div>
  );
}
