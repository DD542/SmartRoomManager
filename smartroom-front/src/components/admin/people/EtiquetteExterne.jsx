import { Globe } from 'lucide-react';
import { Badge } from '../../ui/Badge';

/**
 * Signale un compte dont l'adresse ne relève pas de l'établissement.
 *
 * Depuis que la connexion par compte Google est ouverte, quelqu'un peut entrer
 * avec une adresse personnelle. C'est autorisé — c'est même le but — mais
 * l'administration doit pouvoir distinguer d'un coup d'œil un membre de
 * l'école d'un intervenant extérieur, sans relire chaque adresse.
 *
 * Ce n'est pas un avertissement : le ton est neutre. Un compte externe n'a
 * rien fait de mal, il vient simplement d'ailleurs.
 *
 * L'explication est portée par `title` **et** par le nom accessible : une
 * pastille qui ne se comprend qu'au survol ne se comprend pas au doigt, et
 * pas du tout sans écran.
 */
export function EtiquetteExterne({ email }) {
  const domaine = (email ?? '').split('@')[1];
  const explication = domaine
    ? `Cet utilisateur se connecte avec une adresse hors organisation (${domaine}).`
    : 'Cet utilisateur se connecte avec une adresse hors organisation.';

  return (
    <Badge tone="default" icon={Globe} title={explication} aria-label={explication}>
      Hors organisation
    </Badge>
  );
}
