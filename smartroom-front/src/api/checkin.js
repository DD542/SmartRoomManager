// src/api/checkin.js
// Endpoints réels :
//   POST /api/v1/bookings/{id}/check-in   { code } -> présence validée
//   POST /api/v1/bookings/{id}/late       le créneau reste réservé malgré le retard
//
// La fenêtre elle-même n'est pas une route : elle se déduit du début du créneau
// et de `checkinWindowMin`, deux valeurs déjà chargées par l'écran. Un appel de
// plus n'apporterait qu'une horloge serveur, que le décompte local suit déjà.
//
// Elle s'ouvre au **début** du créneau et dure `checkinWindowMin`. Rien
// n'ouvre avant : le serveur refuse, et l'écran ne doit pas promettre le
// contraire.

import { differenceInSeconds } from 'date-fns';
import * as adapt from './adapters';
import { post } from './client';
import { getBooking } from './bookings';
import { getRoomRules } from './rooms';

export async function getCheckInWindow(bookingId, maintenant = new Date()) {
  const reservation = await getBooking(bookingId);
  const regles = await getRoomRules(reservation.roomId);
  const fenetre = regles.checkinWindowMin ?? 10;

  // La fenêtre est `[début, début + fenêtre)`, comme le serveur l'entend :
  // avant le début il refuse (« La validation ouvre au début du créneau »),
  // après la fenêtre il refuse encore (« Fenêtre de validation dépassée »).
  //
  // Cette fonction prétendait qu'elle s'ouvrait dix minutes **avant** le
  // début. L'écran invitait donc à valider une demi-heure trop tôt, et le
  // serveur répondait 422 à chaque essai — une divergence que rien ne
  // signalait, sinon la console.
  const secondesDepuisLeDebut = differenceInSeconds(maintenant, reservation.start);
  const secondesDeFenetre = fenetre * 60;
  const restantes = Math.max(
    0,
    Math.min(secondesDeFenetre, secondesDeFenetre - secondesDepuisLeDebut),
  );

  return {
    bookingId,
    start: reservation.start,
    open: secondesDepuisLeDebut >= 0 && restantes > 0,
    opensInMin: Math.max(0, Math.ceil(-secondesDepuisLeDebut / 60)),
    windowMin: fenetre,
    remainingMin: Math.ceil(restantes / 60),
    remainingSec: restantes,
    checkedIn: Boolean(reservation.checkedInAt),
    autoReleaseWarning:
      'La salle sera automatiquement libérée si vous ne validez pas votre présence dans le temps imparti.',
  };
}

export async function checkIn(bookingId, code) {
  // Le tiret reste.
  //
  // Le code émis a la forme `E-3716`, et c'est cette chaîne **exacte** dont la
  // base garde l'empreinte — rien d'autre n'est conservé. En retirant le
  // tiret, cette fonction présentait `E3716` : un code que le serveur n'a
  // jamais émis, refusé à juste titre, et l'utilisateur lisait « Code d'accès
  // incorrect » en tapant le bon code.
  //
  // Les espaces partent, eux : ils viennent de la saisie, jamais du code.
  const data = await post(`/bookings/${bookingId}/check-in`, {
    code: String(code ?? '').replace(/\s/g, '').toUpperCase(),
  });
  return adapt.booking(data);
}

/**
 * « Je suis en retard » : le créneau reste réservé au-delà de la fenêtre.
 *
 * La marque vaut validation de présence — sans cela, la tâche de libération
 * rendrait la salle à quelqu'un qui arrive avec dix minutes de retard. Elle ne
 * prolonge aucune fenêtre : rien dans l'API ne prolonge quoi que ce soit.
 */
export async function declareLate(bookingId, delayMin = null) {
  // La durée est une annonce, jamais une condition : sans elle, le corps est
  // vide et le geste reste le plus court de l'écran.
  const corps = delayMin ? { delay_min: Number(delayMin) } : {};
  const data = await post(`/bookings/${bookingId}/late`, corps);
  return { bookingId, delayMin: delayMin ? Number(delayMin) : null, booking: adapt.booking(data) };
}
