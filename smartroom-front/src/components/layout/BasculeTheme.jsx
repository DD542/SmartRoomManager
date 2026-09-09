import { Moon, Sun } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { useTheme } from '../../hooks/useTheme';

/**
 * Bascule entre le thème clair et le thème sombre.
 *
 * Présente dans les trois espaces — présentation, utilisateur, administration —
 * parce qu'un réglage d'affichage qui n'existe que sur une partie du produit
 * oblige à revenir sur cette partie pour le changer.
 *
 * L'icône montre le thème **vers lequel** le bouton mène, et non celui en
 * cours : c'est la convention des interrupteurs, et c'est ce que dit son
 * libellé accessible. Montrer l'état actuel laisserait le doute sur l'effet du
 * clic.
 */
export function BasculeTheme({ className }) {
  const { clair, basculer } = useTheme();

  return (
    <IconButton
      icon={clair ? Moon : Sun}
      label={clair ? 'Passer au thème sombre' : 'Passer au thème clair'}
      onClick={basculer}
      className={className}
    />
  );
}
