/**
 * Rapport PDF de « Mes statistiques ».
 *
 * Fabriqué dans le navigateur, à partir des chiffres déjà affichés : le
 * serveur ne sert qu'un CSV, et un PDF côté serveur demanderait un moteur de
 * rendu pour un contenu que la page a déjà en main.
 *
 * jsPDF est chargé à la demande (`import()` dynamique) : plusieurs centaines de
 * kilo-octets que ne paient que ceux qui exportent, pas chaque visiteur de la
 * page.
 *
 * Les polices standard du PDF ne connaissent que le jeu Windows-1252 : les
 * accents passent, mais pas les espaces fines insécables que produit le
 * formatage français, ni les émojis. `propre()` les ramène à des caractères
 * imprimables avant chaque écriture.
 */
import { fmtDate, fmtDuration, fmtTime, durationMin } from './dates';

const MARINE = [38, 49, 113];
const MARINE_PROFOND = [12, 21, 71];
const CORAIL = [255, 128, 83];
const CREME = [248, 244, 241];
const LAVANDE = [227, 232, 255];
const GRIS = [105, 114, 125];

const STATUTS = {
  confirmee: 'Confirmée',
  en_attente: 'En attente',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

/** Ramène un texte au jeu de caractères des polices standard du PDF. */
const propre = (texte) =>
  String(texte ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^\u0000-ÿ’€Œœ]/g, '')
    .trim();

const pourcent = (ratio) => `${Math.round(Number(ratio || 0) * 100)} %`;

/** En-tête de colonne chiffrée : aligné à droite, comme ses valeurs. */
const aDroite = (texte) => ({ content: texte, styles: { halign: 'right' } });

/** Mois que couvre chaque période : l'histogramme ne montre que ceux-là. */
const MOIS_PAR_PERIODE = { mois: 2, trimestre: 4 };

/**
 * Construit le rapport et le fait télécharger.
 *
 * @param {object} donnees `getMyStats` : kpis, byMonth, byRoom, bySlot,
 *   observation, reservations.
 * @param {object} contexte nom du compte et libellé de la période.
 * @returns {Promise<string>} le nom du fichier produit.
 */
export async function telechargerRapportStats(donnees, { nom, periode, cle }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const largeur = doc.internal.pageSize.getWidth();
  const marge = 16;
  const utile = largeur - marge * 2;

  // --- Bandeau marine ---------------------------------------------------
  doc.setFillColor(...MARINE);
  doc.rect(0, 0, largeur, 34, 'F');
  doc.setFillColor(...CORAIL);
  doc.rect(0, 34, largeur, 1.6, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('SmartRoom Manager', marge, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(propre(`Mes statistiques - ${periode}`), marge, 23);

  doc.setFontSize(9);
  doc.text(propre(nom), largeur - marge, 15, { align: 'right' });
  doc.text(propre(`Édité le ${fmtDate(new Date())}`), largeur - marge, 23, { align: 'right' });

  // --- Indicateurs ------------------------------------------------------
  const k = donnees.kpis;
  const tuiles = [
    { valeur: String(k.bookings ?? 0), libelle: 'réservations actives' },
    { valeur: `${k.hours ?? 0} h`, libelle: 'heures réservées' },
    { valeur: String(k.cancelled ?? 0), libelle: 'annulations' },
    { valeur: pourcent(k.attendance), libelle: 'taux de présence' },
  ];
  const ecart = 4;
  const largeurTuile = (utile - ecart * 3) / 4;
  let y = 46;
  tuiles.forEach((tuile, rang) => {
    const x = marge + rang * (largeurTuile + ecart);
    doc.setFillColor(...CREME);
    doc.roundedRect(x, y, largeurTuile, 24, 3, 3, 'F');
    doc.setTextColor(...MARINE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(tuile.valeur, x + 5, y + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(tuile.libelle, x + 5, y + 18);
  });

  // --- Observation ------------------------------------------------------
  y += 32;
  const lignes = doc.splitTextToSize(propre(donnees.observation), utile - 12);
  const hauteurObs = 10 + lignes.length * 5;
  doc.setFillColor(...LAVANDE);
  doc.roundedRect(marge, y, utile, hauteurObs, 3, 3, 'F');
  doc.setFillColor(...CORAIL);
  doc.rect(marge, y, 1.6, hauteurObs, 'F');
  doc.setTextColor(...MARINE_PROFOND);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Observation', marge + 6, y + 6.5);
  doc.setFont('helvetica', 'normal');
  doc.text(lignes, marge + 6, y + 12);

  // --- Heures par mois : un histogramme dessiné ------------------------
  y += hauteurObs + 12;
  doc.setTextColor(...MARINE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Heures réservées par mois', marge, y);

  // Une période courte ne montre que ses mois : douze barres pour un
  // trimestre, dont huit vides, noyaient les quatre qui comptent.
  const tousLesMois = donnees.byMonth ?? [];
  const mois = MOIS_PAR_PERIODE[cle] ? tousLesMois.slice(-MOIS_PAR_PERIODE[cle]) : tousLesMois;
  const hauteurGraphe = 38;
  const maximum = Math.max(1, ...mois.map((m) => m.hours));
  const pas = mois.length ? utile / mois.length : utile;
  const largeurBarre = Math.min(12, pas * 0.6);
  const base = y + 8 + hauteurGraphe;
  doc.setDrawColor(...CREME);
  doc.line(marge, base, marge + utile, base);
  mois.forEach((m, rang) => {
    const h = (m.hours / maximum) * hauteurGraphe;
    const x = marge + rang * pas + (pas - largeurBarre) / 2;
    doc.setFillColor(...(m.hours === maximum ? CORAIL : MARINE));
    if (h > 0) doc.roundedRect(x, base - h, largeurBarre, h, 1.2, 1.2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'normal');
    doc.text(propre(m.label), x + largeurBarre / 2, base + 4.5, { align: 'center' });
    if (m.hours > 0) {
      doc.setTextColor(...MARINE);
      doc.text(String(m.hours), x + largeurBarre / 2, base - h - 1.5, { align: 'center' });
    }
  });

  // --- Tableaux ---------------------------------------------------------
  const styleTableau = {
    theme: 'plain',
    margin: { left: marge, right: marge },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, textColor: MARINE_PROFOND },
    headStyles: { fillColor: MARINE, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: CREME },
  };

  const hauteurPage = doc.internal.pageSize.getHeight();
  /**
   * Titre de section, gardé avec son tableau : trop près du bas, il restait
   * seul en fin de page, sur le pied de page, et son tableau partait sur la
   * suivante. Il passe alors en haut de la page d'après.
   */
  const titre = (texte, apres) => {
    let position = apres;
    if (position > hauteurPage - 45) {
      doc.addPage();
      position = 22;
    }
    doc.setTextColor(...MARINE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(texte, marge, position);
    return position;
  };

  y = base + 16;
  y = titre('Répartition par salle', y);
  autoTable(doc, {
    ...styleTableau,
    startY: y + 3,
    head: [['Salle', aDroite('Créneaux'), aDroite('Part')]],
    body: (donnees.byRoom ?? []).map((s) => [propre(s.name), String(s.count), pourcent(s.share)]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });

  y = doc.lastAutoTable.finalY + 12;
  y = titre('Répartition par tranche horaire', y);
  autoTable(doc, {
    ...styleTableau,
    startY: y + 3,
    head: [['Tranche', aDroite('Créneaux'), aDroite('Part')]],
    body: (donnees.bySlot ?? []).map((t) => [propre(t.label), String(t.count), pourcent(t.share)]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });

  y = doc.lastAutoTable.finalY + 12;
  y = titre('Réservations de la période', y);
  const reservations = donnees.reservations ?? [];
  autoTable(doc, {
    ...styleTableau,
    startY: y + 3,
    head: [['Date', 'Horaire', 'Salle', 'Objet', aDroite('Durée'), 'Statut']],
    body: reservations.length
      ? reservations.map((r) => [
          fmtDate(r.start),
          `${fmtTime(r.start)} - ${fmtTime(r.end)}`,
          propre(r.roomName),
          propre(r.title),
          propre(fmtDuration(durationMin(r.start, r.end))),
          STATUTS[r.status] ?? propre(r.status),
        ])
      : [[{ content: 'Aucune réservation sur la période.', colSpan: 6 }]],
    columnStyles: { 4: { halign: 'right' } },
  });

  // --- Pied de page sur chaque page -------------------------------------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const bas = hauteurPage - 8;
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'normal');
    doc.text('SmartRoom Manager - rapport personnel', marge, bas);
    doc.text(`Page ${page} / ${pages}`, largeur - marge, bas, { align: 'right' });
  }

  const fichier = `mes-statistiques-${cle}-${fmtDate(new Date()).split('/').reverse().join('-')}.pdf`;
  doc.save(fichier);
  return fichier;
}
