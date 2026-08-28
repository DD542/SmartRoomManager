import { DoorClosed } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Visuel d'une salle, ou un repère à défaut.
 *
 * Un `<img>` sans adresse rend un cadre vide que rien ne signale : ni erreur
 * de console, ni requête en échec, juste un trou dans la carte qu'on prend
 * pour une salle sans photo. Trois écrans avaient chacun leur propre `<img>`
 * nu ; ils partagent maintenant ce repère, faute de quoi le quatrième
 * repartira du même défaut.
 *
 * Le texte alternatif est vide : le nom de la salle est toujours écrit à côté,
 * et le répéter ferait lire deux fois la même chose à un lecteur d'écran.
 */
export function RoomThumb({ room, className, iconSize = 18 }) {
  const photo = room?.photos?.[0];

  if (!photo) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center border border-line bg-surface-raised',
          className,
        )}
      >
        <DoorClosed size={iconSize} className="text-content-faint" />
      </span>
    );
  }

  return (
    <img
      src={photo}
      alt=""
      loading="lazy"
      className={cn('shrink-0 object-cover', className)}
    />
  );
}
