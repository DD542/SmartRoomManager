import { CalendarCog, Repeat, ShieldOff, User } from 'lucide-react';
import { Badge } from '../../ui/Badge';

/**
 * Origine d'une réservation, partagée par la table, le calendrier et le détail.
 *
 * `couleur` sert au calendrier, qui ne peut pas afficher de badge dans un
 * événement de trente pixels ; partout ailleurs le libellé accompagne la teinte.
 */
export const SOURCE_META = {
  utilisateur: { label: 'Utilisateur', tone: 'default', icon: User, couleur: '#5B9BFF' },
  admin: { label: 'Administration', tone: 'accent', icon: CalendarCog, couleur: '#C084FC' },
  recurrente: { label: 'Récurrente', tone: 'success', icon: Repeat, couleur: '#3DDBA6' },
  blocage: { label: 'Blocage', tone: 'warning', icon: ShieldOff, couleur: '#FCC63F' },
};

export function SourceBadge({ source }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.utilisateur;
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** Statut de présence, calculé côté API : attendue, présente ou absente. */
export const ATTENDANCE_META = {
  attendue: { label: 'Attendue', tone: 'default' },
  presente: { label: 'Présent', tone: 'success' },
  absente: { label: 'Absent', tone: 'danger' },
};

export function AttendanceBadge({ attendance }) {
  const meta = ATTENDANCE_META[attendance];
  if (!meta) return <span className="text-xs text-content-faint">—</span>;
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}
