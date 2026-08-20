import { cn } from '../../utils/cn';

const SIZES = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-11 w-11 text-sm' };

/** Pastille d'initiales : aucune image externe, teinte dérivée du nom. */
export function Avatar({ name = '', size = 'md', className, tone }) {
  const parts = name.trim().split(' ');
  const letters = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '?';
  const tones = ['bg-accent-soft text-accent', 'bg-success-soft text-success', 'bg-warning-soft text-warning'];
  const picked = tone ?? tones[letters.charCodeAt(0) % tones.length];

  return (
    <span
      role="img"
      aria-label={name || 'Utilisateur'}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-line font-medium',
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
