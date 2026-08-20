import { toDate } from './dates';

/**
 * Génération d'un fichier iCalendar minimal, sans dépendance.
 * Le back FastAPI exposera le même contenu sur GET /api/bookings/{id}.ics ;
 * la fonction reste utile pour l'export local depuis le navigateur.
 */

const stamp = (value) =>
  toDate(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const escape = (text = '') => String(text).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export function buildIcs(booking) {
  const room = booking.room;
  const location = room ? `${room.name}, ${room.building?.name ?? ''} ${room.floor}` : '';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartRoom Manager//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@smartroom`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(booking.start)}`,
    `DTEND:${stamp(booking.end)}`,
    `SUMMARY:${escape(booking.title)}`,
    `LOCATION:${escape(location)}`,
    `DESCRIPTION:${escape(`Code d'accès : ${booking.accessCode ?? '—'}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Déclenche le téléchargement du fichier .ics dans le navigateur. */
export function downloadIcs(booking) {
  const blob = new Blob([buildIcs(booking)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${booking.title.toLowerCase().replace(/\s+/g, '-')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
