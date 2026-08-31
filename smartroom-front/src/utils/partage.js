import { fmtDateLong, fmtTime } from './dates';

/**
 * Ce qu'on peut dire d'une réservation à quelqu'un d'autre.
 *
 * **Jamais le code d'accès.** C'est le code d'une porte : il ouvre une salle à
 * qui le lit, il n'a pas de destinataire, et une conversation se transfère.
 * L'application ne l'affiche qu'une fois, à son émission, et le journal du
 * serveur lui-même en est expurgé — l'envoyer sur un réseau social annulerait
 * tout le reste.
 *
 * **Jamais le lien vers la réservation.** `/app/reservations/:id` exige une
 * session, et le serveur répond 404 à quiconque n'est pas l'organisateur —
 * délibérément : un 403 confirmerait l'existence de la réservation. Un lien
 * que le destinataire ne peut pas ouvrir est pire qu'aucun lien : il donne
 * l'impression d'avoir partagé quelque chose.
 *
 * Reste ce qui sert vraiment à quelqu'un qu'on invite : où, quand, à quel
 * étage — et le plan pour trouver la porte.
 */
export function resumePartage(booking) {
  const salle = booking.room;
  const lieu = [salle?.name, salle?.building?.name, salle?.floor].filter(Boolean).join(' — ');

  return [
    booking.title || 'Réunion',
    lieu,
    `${fmtDateLong(booking.start)}, ${fmtTime(booking.start)} – ${fmtTime(booking.end)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Invitation d'agenda, sans le code d'accès.
 *
 * `buildIcs` en dépose un dans la description : c'est utile dans l'agenda de
 * l'organisateur, qui a déjà le code, et inacceptable dans un fichier qui
 * change de mains. D'où un second constructeur plutôt qu'un drapeau ajouté au
 * premier — on n'oublie pas de passer un paramètre qui n'existe pas.
 */
export function icsPartageable(booking) {
  const salle = booking.room;
  const lieu = salle
    ? [salle.name, salle.building?.name, salle.floor].filter(Boolean).join(', ')
    : '';
  const horodatage = (valeur) =>
    new Date(valeur).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const echapper = (texte = '') =>
    String(texte).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartRoom Manager//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.id}-partage@smartroom`,
    `DTSTAMP:${horodatage(new Date())}`,
    `DTSTART:${horodatage(booking.start)}`,
    `DTEND:${horodatage(booking.end)}`,
    `SUMMARY:${echapper(booking.title || 'Réunion')}`,
    `LOCATION:${echapper(lieu)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Le navigateur sait-il ouvrir la feuille de partage du système ? */
export const partageNatifDisponible = () =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Les fichiers à joindre : l'invitation d'agenda, et le plan de la salle.
 *
 * Le plan est récupéré depuis `/media`, servi sans authentification — c'est
 * déjà l'image que voit tout utilisateur connecté sur la fiche de la salle.
 * Un échec ne bloque rien : on partage alors le texte seul, plutôt que de
 * refuser un partage pour une vignette manquante.
 */
export async function fichiersDePartage(booking) {
  if (typeof File === 'undefined') return [];

  const fichiers = [
    new File([icsPartageable(booking)], `${gabaritDeNom(booking)}.ics`, {
      type: 'text/calendar',
    }),
  ];

  const plan = booking.room?.locationPlanUrl;
  if (plan) {
    try {
      const reponse = await fetch(plan);
      if (reponse.ok) {
        const contenu = await reponse.blob();
        const extension = (contenu.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
        fichiers.push(
          new File([contenu], `plan-${gabaritDeNom(booking)}.${extension}`, {
            type: contenu.type,
          }),
        );
      }
    } catch {
      // Plan indisponible : le texte porte déjà l'étage et le bâtiment.
    }
  }

  return fichiers;
}

const gabaritDeNom = (booking) =>
  (booking.room?.name ?? booking.title ?? 'reservation')
    .toLowerCase()
    .normalize('NFD')
    // Les diacritiques par leur code : U+0300 a U+036F.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Adresses de partage des applications qui acceptent un texte seul.
 *
 * LinkedIn n'y figure pas : sa route de partage exige une URL publique à
 * référencer, et il n'en existe aucune pour une réservation privée. Un bouton
 * qui ouvrirait un formulaire vide ne partagerait rien.
 */
export function liensDePartage(booking) {
  const texte = resumePartage(booking);
  const encode = encodeURIComponent(texte);

  return [
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encode}` },
    { id: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${encode}` },
    {
      id: 'email',
      label: 'E-mail',
      href: `mailto:?subject=${encodeURIComponent(
        booking.title || 'Réservation',
      )}&body=${encode}`,
    },
  ];
}
