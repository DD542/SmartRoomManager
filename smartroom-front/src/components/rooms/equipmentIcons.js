import {
  Accessibility,
  Armchair,
  Blinds,
  Cable,
  Camera,
  Clock,
  Coffee,
  Fan,
  Headphones,
  Keyboard,
  Laptop,
  Lightbulb,
  Mic,
  Monitor,
  Mouse,
  PenLine,
  Phone,
  Plug,
  Presentation,
  Printer,
  Projector,
  Router,
  ScreenShare,
  Snowflake,
  Sofa,
  Speaker,
  Table,
  Thermometer,
  Tv,
  Usb,
  Video,
  Webcam,
  Wifi,
} from 'lucide-react';

/**
 * Icônes proposées aux équipements du parc.
 *
 * La table n'en comptait que sept — exactement les sept types du jeu de
 * démonstration. Déclarer un équipement nouveau, une imprimante ou une
 * bouilloire, n'offrait donc aucune icône qui lui ressemble : le catalogue
 * s'ouvrait, la liste des icônes non.
 *
 * Les imports restent statiques. Un chargement dynamique par nom rendrait le
 * poids du paquet imprévisible et ferait entrer toute la bibliothèque, pour un
 * gain nul : la liste des équipements est courte et connue à l'avance.
 *
 * L'ordre est celui de la présentation, groupé par usage : ce qui se branche,
 * ce qui s'écrit, ce qui se règle, ce qui s'assoit.
 */
export const EQUIPMENT_ICONS = {
  // Audiovisuel
  Video,
  Webcam,
  Camera,
  Monitor,
  Tv,
  Projector: Presentation,
  ScreenShare,
  Mic,
  Speaker,
  Headphones,
  Phone,

  // Informatique et réseau
  Laptop,
  Keyboard,
  Mouse,
  Printer,
  Wifi,
  Router,
  Cable,
  Usb,
  Plug,

  // Écriture et présentation
  PenLine,
  Presentation,
  Clock,

  // Confort et aménagement
  Snowflake,
  Fan,
  Thermometer,
  Lightbulb,
  Blinds,
  Armchair,
  Sofa,
  Table,
  Coffee,
  Accessibility,
};

/**
 * Icône d'un équipement, ou un écran à défaut.
 *
 * Le repli est délibérément neutre : une icône fausse dit quelque chose de
 * faux sur l'équipement, là où un écran générique n'affirme rien.
 */
export const equipmentIcon = (name) => EQUIPMENT_ICONS[name] ?? Monitor;
