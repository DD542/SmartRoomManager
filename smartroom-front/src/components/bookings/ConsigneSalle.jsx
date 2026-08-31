import { Info } from 'lucide-react';
import { Callout } from '../ui/Card';

/**
 * Consigne écrite par l'administration pour une salle.
 *
 * Rendue par un composant partagé, et non recopiée sur chaque écran : elle
 * apparaît à trois moments du parcours, et trois markups indépendants
 * divergeraient — l'un finirait par ne plus rien afficher sans que personne
 * ne s'en aperçoive, un texte absent ne cassant rien.
 *
 * Elle se distingue des contraintes voisines, qui sont la traduction des
 * seuils numériques — « Durée comprise entre 30 et 240 minutes ». Celle-ci est
 * écrite par quelqu'un : la noyer dans une liste de phrases générées la ferait
 * lire comme l'une d'elles.
 */
export function ConsigneSalle({ notice, className }) {
  if (!notice?.trim()) return null;

  return (
    <Callout tone="warning" icon={Info} title="Consigne de la salle" className={className}>
      {notice}
    </Callout>
  );
}
