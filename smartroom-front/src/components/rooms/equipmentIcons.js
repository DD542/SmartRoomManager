import { Mic, Monitor, PenLine, Plug, Presentation, Snowflake, Video } from 'lucide-react';

/**
 * Table de correspondance entre le champ `icon` du référentiel d'équipements
 * et les composants lucide-react. Un import statique évite tout chargement
 * dynamique et garde le bundle prévisible.
 */
export const EQUIPMENT_ICONS = {
  Video,
  Monitor,
  PenLine,
  Projector: Presentation,
  Mic,
  Plug,
  Snowflake,
};

export const equipmentIcon = (name) => EQUIPMENT_ICONS[name] ?? Monitor;
