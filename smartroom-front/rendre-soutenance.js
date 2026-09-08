/**
 * Diaporama de soutenance — SmartRoom Manager.
 *
 * Suit le canevas du rapport de substitution. Le thème sombre reprend celui du
 * produit : les captures s'y posent sans cadre clair autour d'une interface
 * sombre, et le diaporama et l'application se ressemblent devant le jury.
 */

const pptxgen = require('pptxgenjs');
const path = require('path');

const CAPT = path.resolve(
  'C:/Users/menga/PycharmProjects/smartroommanager/presentation/captures',
);
const SORTIE = path.resolve(
  'C:/Users/menga/PycharmProjects/smartroommanager/presentation/SmartRoomManager-soutenance-2026.pptx',
);

// --- palette, reprise des jetons du produit -------------------------------
const C = {
  fond: '0F1420',
  surface: '1A2231',
  surface2: '232E42',
  accent: '5B9BFF',
  accentSombre: '1B3358',
  contenu: 'E8EEF7',
  muted: '95A3B8',
  faint: '6B7789',
  vert: '3DD68C',
  ambre: 'F0B429',
  rouge: 'FF7A7A',
};
const POLICE = 'Calibri';
const MONO = 'Courier New';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5
const L = 0.75; // marge gauche
const LARG = 13.333 - 2 * L; // largeur utile : 11.833

pres.defineSlideMaster({
  title: 'FOND',
  background: { color: C.fond },
});

let numero = 0;

/** Slide de contenu : titre, sur-titre optionnel, pastille de numéro. */
function slide({ titre, surTitre, notes }) {
  numero += 1;
  const s = pres.addSlide({ masterName: 'FOND' });

  if (surTitre) {
    s.addText(surTitre.toUpperCase(), {
      x: L, y: 0.42, w: LARG, h: 0.26,
      fontFace: POLICE, fontSize: 11, bold: true, charSpacing: 2,
      color: C.accent, isTextBox: true, margin: 0,
    });
  }
  // h volontairement généreuse : un titre d'une ligne reste collé en haut
  // (valign top), et un titre qui déborderait se voit à la relecture.
  s.addText(titre, {
    x: L, y: surTitre ? 0.72 : 0.55, w: LARG - 0.9, h: 0.85,
    fontFace: POLICE, fontSize: 32, bold: true, color: C.contenu,
    isTextBox: true, margin: 0, valign: 'top',
  });

  // pastille de numéro — motif répété du diaporama
  s.addShape(pres.ShapeType.ellipse, {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fill: { color: C.surface2 }, line: { color: C.surface2 },
  });
  s.addText(String(numero), {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fontFace: POLICE, fontSize: 11, bold: true, color: C.muted,
    align: 'center', valign: 'middle', isTextBox: true, margin: 0,
  });

  if (notes) s.addNotes(notes);
  return s;
}

/** Carte : rectangle arrondi teinté, sans liseré d'accent. */
function carte(s, { x, y, w, h, fill = C.surface }) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: fill }, line: { color: C.surface2, width: 1 },
  });
}

function texte(s, t, o) {
  s.addText(t, { fontFace: POLICE, isTextBox: true, margin: 0, ...o });
}

/** Liste à puces sobre. */
function puces(s, items, o) {
  s.addText(
    items.map((t, i) => ({
      text: t,
      options: { bullet: { indent: 14 }, breakLine: i < items.length - 1 },
    })),
    {
      fontFace: POLICE, fontSize: o.fontSize ?? 14, color: o.color ?? C.muted,
      isTextBox: true, margin: 0, paraSpaceAfter: 8, lineSpacing: 20,
      ...o,
    },
  );
}

/** Grand chiffre avec son libellé. */
function chiffre(s, { x, y, w, valeur, libelle, couleur = C.accent }) {
  texte(s, valeur, {
    x, y, w, h: 0.62,
    fontSize: 34, bold: true, color: couleur, align: 'center',
  });
  texte(s, libelle, {
    x, y: y + 0.6, w, h: 0.5,
    fontSize: 11, color: C.muted, align: 'center',
  });
}

/* ══════════════════════════════ 1 — TITRE ══ */
{
  const s = pres.addSlide({ masterName: 'FOND' });
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.75, y: 1.55, w: 3.05, h: 0.42, rectRadius: 0.2,
    fill: { color: C.accentSombre }, line: { color: C.accent, width: 1 },
  });
  texte(s, 'Projet de substitution au stage', {
    x: 0.75, y: 1.55, w: 3.05, h: 0.42,
    fontSize: 12, bold: true, color: C.accent, align: 'center', valign: 'middle',
  });

  texte(s, 'SmartRoom Manager', {
    x: L, y: 2.25, w: 11, h: 1.15,
    fontSize: 54, bold: true, color: C.contenu,
  });
  texte(s, 'Réservation intelligente de salles de campus — de l’analyse du besoin à la mise en production.', {
    x: L, y: 3.45, w: 9.6, h: 0.75,
    fontSize: 17, color: C.muted, lineSpacing: 26,
  });

  texte(s, 'Dylan Menga Wanda   ·   Ngangne Takoudjou Angédarelle   ·   Nguadjong Maeva', {
    x: L, y: 5.5, w: 11.5, h: 0.35,
    fontSize: 14, bold: true, color: C.contenu,
  });
  texte(s, 'ECE Paris   ·   Bachelor 3 Data & Intelligence Artificielle   ·   Année 2025 – 2026', {
    x: L, y: 5.88, w: 11.5, h: 0.35,
    fontSize: 12.5, color: C.faint,
  });
  s.addNotes(
    'Se présenter, annoncer la durée et préciser que la démonstration se fera sur ' +
    'l’application réellement déployée, pas sur une vidéo.',
  );
}

/* ══════════════════════════════ 2 — DÉROULÉ ══ */
{
  const s = slide({
    surTitre: 'Déroulé',
    titre: 'Ce que nous allons montrer',
    notes: 'Annoncer les trois temps forts en direct : Figma, l’application, l’assistant. ' +
      'Cela prépare le jury aux bascules et évite l’effet de surprise.',
  });

  const etapes = [
    ['01', 'Le problème et le besoin', 'Trois problèmes distincts, dix cas d’usage, étude de l’existant'],
    ['02', 'Conception', 'Maquettage Figma — présenté en direct'],
    ['03', 'Architecture et modélisation', 'Quatre couches, diagrammes UML'],
    ['04', 'Réalisation et Data / IA', 'Intégrité des créneaux, recommandation, assistant outillé'],
    ['05', 'Démonstration', 'L’application déployée, en direct'],
    ['06', 'Qualité, déploiement, bilan', '1 576 tests, mise en production, enseignements'],
  ];

  etapes.forEach(([n, titre, detail], i) => {
    const y = 1.72 + i * 0.85;
    s.addShape(pres.ShapeType.ellipse, {
      x: L, y: y + 0.05, w: 0.52, h: 0.52,
      fill: { color: C.accentSombre }, line: { color: C.accent, width: 1 },
    });
    texte(s, n, {
      x: L, y: y + 0.05, w: 0.52, h: 0.52,
      fontSize: 12, bold: true, color: C.accent, align: 'center', valign: 'middle',
    });
    texte(s, titre, {
      x: L + 0.78, y: y + 0.02, w: 5.2, h: 0.32,
      fontSize: 16, bold: true, color: C.contenu,
    });
    texte(s, detail, {
      x: L + 0.78, y: y + 0.34, w: 8.6, h: 0.3,
      fontSize: 12.5, color: C.muted,
    });
  });
}

/* ══════════════════════════════ 3 — LE PROBLÈME ══ */
{
  const s = slide({
    surTitre: '1 — Contexte',
    titre: 'Trois problèmes, trois réponses techniques',
    notes: 'Insister sur le problème C : c’est le moins visible et le plus coûteux, ' +
      'et c’est celui qu’aucune solution gratuite du marché ne traite.',
  });

  const pb = [
    ['A', 'On ne sait pas ce qui est libre', 'Le coût n’est pas le temps passé, c’est le renoncement : on réserve « au cas où », ce qui aggrave la pénurie subie.', C.accent],
    ['B', 'Deux personnes réservent le même créneau', 'Sans arbitre technique, le conflit se découvre devant la porte. Le coût réel : la réunion qui n’a pas lieu.', C.ambre],
    ['C', 'Les salles réservées restent vides', 'Invisible : occupée dans le système, vide dans la réalité. Sans mesure de présence, rien ne se libère.', C.rouge],
  ];

  pb.forEach(([lettre, titre, corps, couleur], i) => {
    const x = L + i * 4.02;
    carte(s, { x, y: 1.75, w: 3.72, h: 3.5 });
    s.addShape(pres.ShapeType.roundRect, {
      x: x + 0.32, y: 2.1, w: 0.52, h: 0.52, rectRadius: 0.12,
      fill: { color: C.surface2 }, line: { color: couleur, width: 1 },
    });
    texte(s, lettre, {
      x: x + 0.32, y: 2.1, w: 0.52, h: 0.52,
      fontSize: 15, bold: true, color: couleur, align: 'center', valign: 'middle',
    });
    texte(s, titre, {
      x: x + 0.32, y: 2.85, w: 3.08, h: 0.85,
      fontSize: 16, bold: true, color: C.contenu, lineSpacing: 22,
    });
    texte(s, corps, {
      x: x + 0.32, y: 3.78, w: 3.08, h: 1.25,
      fontSize: 12.5, color: C.muted, lineSpacing: 18,
    });
  });

  texte(s, 'Le troisième est le moins visible et le plus coûteux : aucune des solutions gratuites étudiées ne le traite.', {
    x: L, y: 5.6, w: LARG, h: 0.4,
    fontSize: 14, italic: true, color: C.faint,
  });
}

/* ══════════════════════════════ 4 — PROBLÉMATIQUE ══ */
{
  const s = slide({
    surTitre: '2 — Problématique et objectifs',
    titre: 'Correction, utilité, robustesse',
    notes: 'La troisième exigence — rester fonctionnel sans IA — est celle qui a le plus ' +
      'structuré l’architecture. Elle explique l’étage C de l’assistant.',
  });

  carte(s, { x: L, y: 1.7, w: LARG, h: 1.15, fill: C.accentSombre });
  texte(s, 'Comment garantir l’absence de double réservation quelles que soient les conditions de concurrence, assister réellement l’utilisateur dans son choix, et rester fonctionnel lorsque les composants d’intelligence artificielle sont indisponibles ?', {
    x: L + 0.35, y: 1.88, w: LARG - 0.7, h: 0.85,
    fontSize: 15, bold: true, color: C.contenu, lineSpacing: 22,
  });

  const objectifs = [
    ['O1', 'Le double créneau est impossible', '1 demande sur 10 aboutit, en concurrence'],
    ['O2', 'Le choix de la salle est assisté', 'classement ordonné et justifié'],
    ['O3', 'Les créneaux non honorés se libèrent', 'validation de présence bornée'],
    ['O4', 'L’administration est complète', '7 permissions cloisonnées'],
    ['O5', 'L’assistant s’appuie sur la base réelle', '14 outils, jamais sur une supposition'],
    ['O6', 'La dégradation reste propre', 'sans modèle, l’application fonctionne'],
  ];
  objectifs.forEach(([ref, titre, critere], i) => {
    const col = i % 2;
    const lig = Math.floor(i / 2);
    const x = L + col * 6.0;
    const y = 3.2 + lig * 1.0;
    texte(s, ref, {
      x, y, w: 0.6, h: 0.3, fontSize: 14, bold: true, color: C.accent,
    });
    texte(s, titre, {
      x: x + 0.62, y, w: 5.1, h: 0.3, fontSize: 14.5, bold: true, color: C.contenu,
    });
    texte(s, critere, {
      x: x + 0.62, y: y + 0.32, w: 5.1, h: 0.3, fontSize: 12, color: C.muted,
    });
  });

  texte(s, 'Chaque objectif a été assorti d’un critère de réussite énoncé avant la réalisation.', {
    x: L, y: 6.32, w: LARG, h: 0.35, fontSize: 13, italic: true, color: C.faint,
  });
}

/* ══════════════════════════════ 5 — ANALYSE ══ */
{
  const s = slide({
    surTitre: '3 — Analyse du besoin',
    titre: 'Quatre acteurs, dix cas d’usage',
    notes: 'Le jeu de démonstration porte cinq comptes d’administration aux périmètres ' +
      'volontairement différents : sans cela, le cloisonnement ne serait pas démontrable.',
  });

  carte(s, { x: L, y: 1.72, w: 5.6, h: 3.9 });
  texte(s, 'Acteurs', {
    x: L + 0.32, y: 2.0, w: 4.9, h: 0.34, fontSize: 17, bold: true, color: C.contenu,
  });
  const acteurs = [
    ['Utilisateur', 'cherche, réserve, valide sa présence'],
    ['Administrateur', 'parc, règles, conflits, support'],
    ['Propriétaire', 'les sept permissions, gère les administrateurs'],
    ['Ordonnanceur', 'acteur système : libère, clôt, notifie'],
  ];
  acteurs.forEach(([nom, role], i) => {
    const y = 2.55 + i * 0.72;
    s.addShape(pres.ShapeType.ellipse, {
      x: L + 0.32, y: y + 0.04, w: 0.28, h: 0.28,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    texte(s, nom, {
      x: L + 0.75, y, w: 4.5, h: 0.28, fontSize: 14.5, bold: true, color: C.contenu,
    });
    texte(s, role, {
      x: L + 0.75, y: y + 0.3, w: 4.5, h: 0.28, fontSize: 12, color: C.muted,
    });
  });

  carte(s, { x: L + 6.0, y: 1.72, w: 5.83, h: 3.9 });
  texte(s, 'Cas d’usage structurants', {
    x: L + 6.32, y: 2.0, w: 5.2, h: 0.34, fontSize: 17, bold: true, color: C.contenu,
  });
  puces(s, [
    'Réserver — n’affiche que des salles libres et conformes',
    'Valider sa présence — fenêtre de dix minutes',
    'Arbitrer un conflit — référence lisible, décision tracée',
    'Configurer les règles — trois portées possibles',
    'Interroger l’assistant — en langage naturel',
  ], { x: L + 6.32, y: 2.5, w: 5.2, h: 2.9, fontSize: 13.5 });

  texte(s, 'Étude de l’existant : aucune solution gratuite examinée ne place la garantie d’intégrité dans la base de données, ni ne mesure la présence effective.', {
    x: L, y: 5.85, w: LARG, h: 0.6, fontSize: 13.5, italic: true, color: C.faint, lineSpacing: 20,
  });
}

/* ══════════════════════════════ 6 — MÉTHODE ══ */
{
  const s = slide({
    surTitre: '4 — Méthodologie',
    titre: 'Itérations fonctionnelles et preuve',
    notes: 'Les deux règles de travail sont le vrai apport méthodologique. La contre-épreuve ' +
      'a invalidé un correctif que nous croyions bon : le raconter si le jury creuse.',
  });

  carte(s, { x: L, y: 1.72, w: 5.6, h: 2.2, fill: C.surface });
  texte(s, 'Règle 1 — Mesurer avant d’affirmer', {
    x: L + 0.32, y: 1.98, w: 4.96, h: 0.32, fontSize: 15.5, bold: true, color: C.accent,
  });
  texte(s, 'Aucun diagnostic retenu sans une observation qui l’établit. Plusieurs de nos hypothèses initiales se sont révélées fausses.', {
    x: L + 0.32, y: 2.4, w: 4.96, h: 1.2, fontSize: 13, color: C.muted, lineSpacing: 20,
  });

  carte(s, { x: L + 6.0, y: 1.72, w: 5.83, h: 2.2, fill: C.surface });
  texte(s, 'Règle 2 — Un test qui ne peut pas échouer ne prouve rien', {
    x: L + 6.32, y: 1.98, w: 5.19, h: 0.32, fontSize: 15.5, bold: true, color: C.accent,
  });
  texte(s, 'Chaque correctif est accompagné d’une contre-épreuve : on vérifie que le test échoue bien sans lui.', {
    x: L + 6.32, y: 2.4, w: 5.19, h: 1.2, fontSize: 13, color: C.muted, lineSpacing: 20,
  });

  texte(s, 'Répartition des rôles', {
    x: L, y: 4.15, w: LARG, h: 0.34, fontSize: 17, bold: true, color: C.contenu,
  });
  const roles = [
    ['Dylan Menga Wanda', 'Back-end, modèle de données, concurrence, assistant, déploiement'],
    ['Ngangne T. Angédarelle', 'Maquettage Figma, système de design, front-end, tests d’interface'],
    ['Nguadjong Maeva', 'Analyse, règles métier, recommandation, stratégie de tests, recette'],
  ];
  roles.forEach(([nom, perimetre], i) => {
    const x = L + i * 4.02;
    carte(s, { x, y: 4.62, w: 3.72, h: 1.55, fill: C.surface2 });
    texte(s, nom, {
      x: x + 0.28, y: 4.85, w: 3.16, h: 0.3, fontSize: 14, bold: true, color: C.contenu,
    });
    texte(s, perimetre, {
      x: x + 0.28, y: 5.2, w: 3.16, h: 0.85, fontSize: 12, color: C.muted, lineSpacing: 17,
    });
  });
}

/* ══════════════════════════════ 7 — BASCULE FIGMA ══ */
{
  numero += 1;
  const s = pres.addSlide({ masterName: 'FOND' });

  s.addShape(pres.ShapeType.roundRect, {
    x: 0.75, y: 1.5, w: 2.35, h: 0.42, rectRadius: 0.2,
    fill: { color: C.accentSombre }, line: { color: C.accent, width: 1 },
  });
  texte(s, 'Démonstration', {
    x: 0.75, y: 1.5, w: 2.35, h: 0.42,
    fontSize: 12, bold: true, color: C.accent, align: 'center', valign: 'middle',
  });

  texte(s, 'Les maquettes, sur Figma', {
    x: L, y: 2.2, w: 11, h: 0.9, fontSize: 44, bold: true, color: C.contenu,
  });
  texte(s, 'Bascule vers Figma — les vingt écrans maquettés avant la première ligne de code.', {
    x: L, y: 3.15, w: 9.5, h: 0.5, fontSize: 16, color: C.muted,
  });

  const points = [
    ['Figer le vocabulaire', 'créneau, battement, préavis, repère, plan d’étage — un objet, un seul nom'],
    ['Révéler les trous fonctionnels', 'la fenêtre de validation et la référence de conflit sont nées en dessinant'],
    ['Fixer le système de design', 'jetons, états, composants — 20 maquettes ont produit 52 écrans et 152 composants'],
  ];
  points.forEach(([titre, detail], i) => {
    const y = 4.1 + i * 0.82;
    s.addShape(pres.ShapeType.ellipse, {
      x: L, y: y + 0.06, w: 0.3, h: 0.3,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    texte(s, titre, {
      x: L + 0.5, y, w: 4.0, h: 0.3, fontSize: 15, bold: true, color: C.contenu,
    });
    texte(s, detail, {
      x: L + 4.6, y: y + 0.02, w: 7.2, h: 0.55, fontSize: 12.5, color: C.muted, lineSpacing: 17,
    });
  });

  s.addShape(pres.ShapeType.ellipse, {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fill: { color: C.surface2 }, line: { color: C.surface2 },
  });
  texte(s, String(numero), {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fontSize: 11, bold: true, color: C.muted, align: 'center', valign: 'middle',
  });

  s.addNotes(
    'BASCULER SUR FIGMA MAINTENANT. Ouvrir le fichier de maquettes préparé, plein écran. ' +
    'Montrer trois choses et pas davantage : (1) la bibliothèque de composants et les jetons ' +
    'de couleur, (2) le tunnel de réservation en quatre étapes, (3) l’écran de validation de ' +
    'présence, en expliquant que la fenêtre de dix minutes est née de cet écran. ' +
    'Compter trois minutes, puis revenir au diaporama.',
  );
}

/* ══════════════════════════════ 8 — ARCHITECTURE ══ */
{
  const s = slide({
    surTitre: '5 — Architecture',
    titre: 'Quatre couches, une règle stricte',
    notes: 'Insister : la pureté du domaine est ce qui rend le seuil de 100 % atteignable ' +
      'sans monter la moindre base de données.',
  });

  const couches = [
    ['app/api', 'Routage, validation, sérialisation', 'Interdit : toute règle métier'],
    ['app/services', 'Orchestration métier — 17 services', 'Interdit : connaître HTTP'],
    ['app/domain', 'Règles pures, sans dépendance', 'Interdit : importer SQLAlchemy'],
    ['app/models', 'Cartographie SQLAlchemy', 'Interdit : contenir de la logique'],
  ];
  couches.forEach(([nom, role, interdit], i) => {
    const y = 1.75 + i * 0.92;
    carte(s, { x: L, y, w: 7.2, h: 0.78, fill: i === 2 ? C.accentSombre : C.surface });
    texte(s, nom, {
      x: L + 0.3, y: y + 0.13, w: 1.9, h: 0.3,
      fontSize: 13.5, bold: true, color: i === 2 ? C.accent : C.contenu, fontFace: MONO,
    });
    texte(s, role, {
      x: L + 2.3, y: y + 0.13, w: 3.0, h: 0.3, fontSize: 12.5, color: C.contenu,
    });
    texte(s, interdit, {
      x: L + 2.3, y: y + 0.42, w: 4.6, h: 0.28, fontSize: 11, color: C.faint,
    });
  });

  carte(s, { x: L + 7.6, y: 1.75, w: 4.23, h: 3.85, fill: C.surface2 });
  texte(s, 'Ce que cette règle apporte', {
    x: L + 7.9, y: 2.02, w: 3.63, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  puces(s, [
    'Le domaine se teste sans base de données',
    '100 % de couverture de branches y est exigé',
    'Un défaut de règle se corrige au même endroit',
    'Trois personnes ont travaillé en parallèle sans se gêner',
  ], { x: L + 7.9, y: 2.5, w: 3.63, h: 2.8, fontSize: 12.5 });

  texte(s, 'PostgreSQL et pgvector · FastAPI et SQLAlchemy 2 · React, Vite et Tailwind · 128 routes · 46 tables · 13 migrations', {
    x: L, y: 5.85, w: LARG, h: 0.4, fontSize: 13, color: C.faint,
  });
}

/* ══════════════════════════════ 9 — DIAGRAMMES ══ */
{
  const s = slide({
    surTitre: '6 — Modélisation',
    titre: 'La structure du système',
    notes: 'Ne pas détailler les classes une par une. Dire ce que le diagramme de classes ' +
      'montre de particulier : la composition bâtiment-étage, et les dépendances de la ' +
      'couche service vers le domaine, jamais l’inverse.',
  });

  // Les diagrammes sont sur fond blanc : la carte l'est aussi, sinon le
  // rectangle clair de l'image tranche au milieu d'un slide sombre.
  const struct = [
    ['diag-cas-usage.png', 'Cas d’utilisation', 'Quatre acteurs, périmètre du système, relations « inclut » et « étend », héritage d’acteur.'],
    ['diag-classes.png', 'Classes', 'Seize classes du domaine et la couche service, avec ses dépendances.'],
  ];
  struct.forEach(([fichier, titre, detail], i) => {
    const x = L + i * 6.23;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.82, w: 5.6, h: 3.35, rectRadius: 0.08,
      fill: { color: 'FFFFFF' }, line: { color: C.surface2, width: 1 },
    });
    s.addImage({
      path: path.join(CAPT, fichier),
      x: x + 0.12, y: 1.94, w: 5.36, h: 3.11,
      sizing: { type: 'contain', w: 5.36, h: 3.11 },
    });
    texte(s, titre, {
      x, y: 5.32, w: 5.6, h: 0.32, fontSize: 16, bold: true, color: C.contenu,
    });
    texte(s, detail, {
      x, y: 5.68, w: 5.6, h: 0.7, fontSize: 12.5, color: C.muted, lineSpacing: 18,
    });
  });
}

/* ══════════════════════════════ 9 bis — SÉQUENCES ══ */
{
  const s = slide({
    surTitre: '6 — Modélisation',
    titre: 'Deux scénarios dynamiques',
    notes: 'Ces deux diagrammes portent les deux mécanismes centraux. Si le jury n’en ' +
      'regarde qu’un, montrer celui de la réservation : le verrou pris avant la ' +
      'vérification y est explicite. Les quatre figurent en pleine page dans le document remis.',
  });

  const seqs = [
    ['diag-sequence-reservation.png', 'Réserver une salle'],
    ['diag-sequence-assistant.png', 'Interroger l’assistant'],
  ];
  seqs.forEach(([fichier, titre], i) => {
    const x = L + i * 3.62;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.8, w: 3.35, h: 4.3, rectRadius: 0.08,
      fill: { color: 'FFFFFF' }, line: { color: C.surface2, width: 1 },
    });
    s.addImage({
      path: path.join(CAPT, fichier),
      x: x + 0.12, y: 1.92, w: 3.11, h: 4.06,
      sizing: { type: 'contain', w: 3.11, h: 4.06 },
    });
    texte(s, titre, {
      x, y: 6.22, w: 3.35, h: 0.32, fontSize: 14.5, bold: true, color: C.contenu,
      align: 'center',
    });
  });

  carte(s, { x: L + 7.6, y: 1.8, w: 4.23, h: 4.3, fill: C.surface });
  texte(s, 'Ce que ces deux scénarios montrent', {
    x: L + 7.9, y: 2.05, w: 3.63, h: 0.34, fontSize: 15, bold: true, color: C.accent,
  });
  puces(s, [
    'Le verrou de transaction est pris avant la vérification, pas avant l’insertion',
    'Le fragment « alt » couvre le créneau libre et le créneau déjà pris',
    'L’assistant appelle un outil, puis diffuse sa réponse par événements',
    'La bascule vers le moteur déterministe est une alternative, non un ajout',
  ], { x: L + 7.9, y: 2.55, w: 3.63, h: 3.3, fontSize: 12.5 });
}

/* ══════════════════════════════ 10 — INTÉGRITÉ ══ */
{
  const s = slide({
    surTitre: '7 — Le cœur technique',
    titre: 'Le chevauchement n’est pas improbable : il est impossible',
    notes: 'C’est le point le plus fort de la soutenance. Si le jury ne retient qu’une chose, ' +
      'c’est que la garantie est portée par la base, donc incontournable — y compris par un ' +
      'INSERT fait à la main.',
  });

  carte(s, { x: L, y: 1.7, w: 7.2, h: 1.75, fill: C.surface2 });
  texte(s,
    'ALTER TABLE bookings ADD CONSTRAINT ex_bookings_no_overlap\n' +
    'EXCLUDE USING gist (\n' +
    '\u00a0\u00a0\u00a0\u00a0room_id WITH =,\n' +
    '\u00a0\u00a0\u00a0\u00a0tstzrange(start_at, end_at, \'[)\') WITH &&\n' +
    ') WHERE (status <> \'annulee\');', {
    x: L + 0.3, y: 1.9, w: 6.6, h: 1.4,
    fontFace: MONO, fontSize: 12, color: C.contenu, lineSpacing: 16,
  });

  carte(s, { x: L + 7.6, y: 1.7, w: 4.23, h: 1.75, fill: C.surface });
  texte(s, 'Deux détails qui comptent', {
    x: L + 7.9, y: 1.9, w: 3.63, h: 0.3, fontSize: 14, bold: true, color: C.contenu,
  });
  texte(s, '[) — 9 h–10 h et 10 h–11 h coexistent, ce qu’attend l’intuition.\n\nWHERE — une annulation libère le créneau sans effacer la trace.', {
    x: L + 7.9, y: 2.28, w: 3.63, h: 1.05, fontSize: 12, color: C.muted, lineSpacing: 17,
  });

  texte(s, 'La contrainte garantit l’intégrité — elle ne suffit pas à produire une bonne erreur', {
    x: L, y: 3.75, w: LARG, h: 0.35, fontSize: 16, bold: true, color: C.contenu,
  });
  texte(s, 'Dix demandes simultanées concluent toutes que la salle est libre, puis s’affrontent. PostgreSQL détecte un cycle d’attente et sacrifie une transaction : l’utilisateur recevait une erreur technique là où il devait lire que le créneau venait d’être pris.', {
    x: L, y: 4.15, w: 7.2, h: 1.1, fontSize: 13, color: C.muted, lineSpacing: 19,
  });

  carte(s, { x: L, y: 5.35, w: 7.2, h: 0.75, fill: C.surface2 });
  texte(s, 'SELECT pg_advisory_xact_lock(hashtext(\'salle:\' || :room_id));', {
    x: L + 0.3, y: 5.5, w: 6.6, h: 0.3, fontFace: MONO, fontSize: 11.5, color: C.vert,
  });
  texte(s, 'Pris AVANT la vérification : c’est la séquence lire-puis-écrire qui doit être indivisible.', {
    x: L + 0.3, y: 5.78, w: 6.6, h: 0.28, fontSize: 11, color: C.muted,
  });

  carte(s, { x: L + 7.6, y: 3.65, w: 4.23, h: 2.45, fill: C.surface });
  texte(s, 'Résultat mesuré', {
    x: L + 7.9, y: 3.9, w: 3.63, h: 0.3, fontSize: 14, bold: true, color: C.contenu,
  });
  chiffre(s, { x: L + 7.9, y: 4.35, w: 3.63, valeur: '1 sur 10', libelle: 'demandes simultanées aboutit', couleur: C.vert });
  texte(s, 'Les neuf autres reçoivent un message métier compréhensible, jamais une erreur technique.', {
    x: L + 7.9, y: 5.4, w: 3.63, h: 0.6, fontSize: 11.5, color: C.muted, lineSpacing: 16,
  });
}

/* ══════════════════════════════ 11 — RECOMMANDATION ══ */
{
  const s = slide({
    surTitre: '8 — Data & IA (1/3)',
    titre: 'Un moteur de recommandation explicable',
    notes: 'L’explicabilité n’est pas un supplément d’âme : sans justification, l’utilisateur ' +
      'reprend la salle qu’il connaît et le moteur ne sert à rien.',
  });

  const comp = [
    ['Adéquation de capacité', 'une salle de 90 places pour 4 personnes est un gâchis : l’écart est pénalisé dans les deux sens'],
    ['Équipements', 'présence de ce qui a été explicitement demandé'],
    ['Proximité', 'bâtiment habituel, renseigné à l’inscription'],
    ['Accessibilité', 'conformité PMR lorsqu’elle est requise'],
    ['Occupation', 'répartir l’usage plutôt que saturer toujours les mêmes salles'],
  ];
  comp.forEach(([nom, detail], i) => {
    const y = 1.78 + i * 0.72;
    texte(s, nom, {
      x: L, y, w: 3.1, h: 0.3, fontSize: 14, bold: true, color: C.contenu,
    });
    texte(s, detail, {
      x: L + 3.25, y: y + 0.01, w: 4.15, h: 0.62, fontSize: 12, color: C.muted, lineSpacing: 16,
    });
  });

  carte(s, { x: L + 7.8, y: 1.75, w: 4.03, h: 3.6, fill: C.surface });
  texte(s, 'Pourquoi l’explicabilité', {
    x: L + 8.1, y: 2.0, w: 3.43, h: 0.32, fontSize: 15, bold: true, color: C.accent,
  });
  texte(s, 'Chaque composante est calculée séparément et exposée : l’interface peut dire pourquoi une salle arrive en tête.\n\nSans justification, l’utilisateur reprend la salle qu’il connaît — et le moteur ne sert à rien.', {
    x: L + 8.1, y: 2.45, w: 3.43, h: 2.0, fontSize: 12.5, color: C.muted, lineSpacing: 19,
  });
  texte(s, 'Couvert à 100 % de ses branches, sans aucune dépendance externe.', {
    x: L + 8.1, y: 4.6, w: 3.43, h: 0.6, fontSize: 12, italic: true, color: C.faint, lineSpacing: 17,
  });

  texte(s, 'Le calcul vit dans app/domain/recommendation.py — couche pure, testable en millisecondes.', {
    x: L, y: 5.65, w: LARG, h: 0.4, fontSize: 13, color: C.faint,
  });
}

/* ══════════════════════════════ 12 — ASSISTANT ══ */
{
  const s = slide({
    surTitre: '9 — Data & IA (2/3)',
    titre: 'Un assistant outillé, sur trois étages',
    notes: 'L’étage C n’est pas une panne : c’est un moteur déterministe qui appelle les mêmes ' +
      'outils. La mesure sur les cinq essais est le meilleur argument du projet.',
  });

  const etages = [
    ['A', 'Ollama', 'Poste de développement', 'Gratuit, hors ligne, aucune donnée ne sort du poste', C.accent],
    ['B', 'API distante', 'Production', 'Aucun hébergement gratuit ne fait tourner 7 milliards de paramètres', C.ambre],
    ['C', 'Moteur déterministe', 'Toujours disponible', 'Ce n’est pas une panne : mêmes outils, sans aucun modèle', C.vert],
  ];
  etages.forEach(([lettre, nom, ou, detail, couleur], i) => {
    const x = L + i * 4.02;
    carte(s, { x, y: 1.75, w: 3.72, h: 2.35 });
    s.addShape(pres.ShapeType.roundRect, {
      x: x + 0.3, y: 2.0, w: 0.46, h: 0.46, rectRadius: 0.1,
      fill: { color: C.surface2 }, line: { color: couleur, width: 1 },
    });
    texte(s, lettre, {
      x: x + 0.3, y: 2.0, w: 0.46, h: 0.46,
      fontSize: 14, bold: true, color: couleur, align: 'center', valign: 'middle',
    });
    texte(s, nom, {
      x: x + 0.88, y: 2.02, w: 2.6, h: 0.3, fontSize: 15, bold: true, color: C.contenu,
    });
    texte(s, ou, {
      x: x + 0.88, y: 2.3, w: 2.6, h: 0.26, fontSize: 11.5, color: C.faint,
    });
    texte(s, detail, {
      x: x + 0.3, y: 2.75, w: 3.12, h: 1.05, fontSize: 12, color: C.muted, lineSpacing: 17,
    });
  });

  texte(s, 'Une mesure qui a modifié notre conception', {
    x: L, y: 4.35, w: LARG, h: 0.35, fontSize: 16, bold: true, color: C.contenu,
  });
  texte(s, 'Cinq essais de « donne-moi mes prochaines réservations », pour un compte qui en possède cinq :', {
    x: L, y: 4.72, w: 7.5, h: 0.3, fontSize: 12.5, color: C.muted,
  });

  const mesures = [
    ['qwen2.5:7b', '3 fois sur 5', 'réponse variable', C.ambre],
    ['qwen2.5:14b', '0 fois sur 3', 'réponse fausse', C.rouge],
    ['Moteur déterministe', '2 fois sur 2', 'réponse juste', C.vert],
  ];
  mesures.forEach(([moteur, appel, verdict, couleur], i) => {
    const y = 5.15 + i * 0.42;
    texte(s, moteur, {
      x: L, y, w: 2.6, h: 0.3, fontSize: 12.5, color: C.contenu,
    });
    texte(s, appel, {
      x: L + 2.7, y, w: 1.6, h: 0.3, fontSize: 12.5, fontFace: MONO, color: C.muted,
    });
    texte(s, verdict, {
      x: L + 4.4, y, w: 3.0, h: 0.3, fontSize: 12.5, bold: true, color: couleur,
    });
  });

  carte(s, { x: L + 7.8, y: 4.3, w: 4.03, h: 1.95, fill: C.accentSombre });
  texte(s, 'Ce que nous en avons conclu', {
    x: L + 8.1, y: 4.5, w: 3.43, h: 0.3, fontSize: 13.5, bold: true, color: C.accent,
  });
  texte(s, 'Quand le modèle n’appelle rien, il écrit une phrase plausible devant un agenda plein — et l’utilisateur ne peut pas la distinguer d’une vraie réponse.', {
    x: L + 8.1, y: 4.88, w: 3.43, h: 1.2, fontSize: 12, color: C.contenu, lineSpacing: 17,
  });
}

/* ══════════════════════════════ 13 — RECHERCHE HYBRIDE ══ */
{
  const s = slide({
    surTitre: '10 — Data & IA (3/3)',
    titre: 'Recherche hybride : deux volets, deux échecs',
    notes: 'Le premier exemple est le plus parlant : la question ne partage aucun mot avec ' +
      'l’article qui y répond. C’est exactement ce que le lexical ne peut pas faire.',
  });

  carte(s, { x: L, y: 1.75, w: 5.6, h: 1.6, fill: C.surface });
  texte(s, 'Volet vectoriel', {
    x: L + 0.3, y: 1.98, w: 5.0, h: 0.3, fontSize: 14.5, bold: true, color: C.accent,
  });
  texte(s, 'Retrouve un sens sans partager un mot. Rate un identifiant ou un nom propre, que l’embedding dilue.', {
    x: L + 0.3, y: 2.35, w: 5.0, h: 0.85, fontSize: 12.5, color: C.muted, lineSpacing: 18,
  });

  carte(s, { x: L + 6.0, y: 1.75, w: 5.83, h: 1.6, fill: C.surface });
  texte(s, 'Volet lexical', {
    x: L + 6.3, y: 1.98, w: 5.23, h: 0.3, fontSize: 14.5, bold: true, color: C.accent,
  });
  texte(s, 'Trouve le mot exact et rien d’autre. Ne sait pas qu’annuler et supprimer sont proches.', {
    x: L + 6.3, y: 2.35, w: 5.23, h: 0.85, fontSize: 12.5, color: C.muted, lineSpacing: 18,
  });

  texte(s, 'Fusion par rangs réciproques — une similarité cosinus et un ts_rank ne vivent pas sur la même échelle : les additionner reviendrait à comparer des degrés et des kilomètres.', {
    x: L, y: 3.5, w: LARG, h: 0.55, fontSize: 13.5, color: C.contenu, lineSpacing: 20,
  });

  texte(s, 'Apport mesuré sur notre corpus réel', {
    x: L, y: 4.25, w: LARG, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });

  const lignes = [
    ['« comment je préviens que je suis arrivé »', 'aucun résultat', 'Valider ma présence sur place'],
    ['« ma réunion est annulée que faire »', 'À quoi sert SmartRoom', 'Modifier l’horaire ou la salle'],
  ];
  texte(s, 'Question posée', { x: L, y: 4.68, w: 5.0, h: 0.26, fontSize: 11, bold: true, color: C.faint });
  texte(s, 'Lexical seul', { x: L + 5.2, y: 4.68, w: 3.0, h: 0.26, fontSize: 11, bold: true, color: C.faint });
  texte(s, 'Recherche hybride', { x: L + 8.4, y: 4.68, w: 3.4, h: 0.26, fontSize: 11, bold: true, color: C.faint });

  lignes.forEach(([q, avant, apres], i) => {
    const y = 5.02 + i * 0.52;
    texte(s, q, { x: L, y, w: 5.0, h: 0.38, fontSize: 12.5, color: C.contenu, lineSpacing: 17 });
    texte(s, avant, { x: L + 5.2, y, w: 3.0, h: 0.38, fontSize: 12.5, color: C.rouge });
    texte(s, apres, { x: L + 8.4, y, w: 3.4, h: 0.38, fontSize: 12.5, color: C.vert, lineSpacing: 17 });
  });

  texte(s, 'La première question ne partage aucun mot avec l’article qui y répond.', {
    x: L, y: 6.2, w: LARG, h: 0.35, fontSize: 12.5, italic: true, color: C.faint,
  });
}

/* ══════════════════════════════ 14 — BASCULE DÉMO ══ */
{
  numero += 1;
  const s = pres.addSlide({ masterName: 'FOND' });

  s.addShape(pres.ShapeType.roundRect, {
    x: 0.75, y: 1.35, w: 2.35, h: 0.42, rectRadius: 0.2,
    fill: { color: C.accentSombre }, line: { color: C.accent, width: 1 },
  });
  texte(s, 'Démonstration', {
    x: 0.75, y: 1.35, w: 2.35, h: 0.42,
    fontSize: 12, bold: true, color: C.accent, align: 'center', valign: 'middle',
  });
  texte(s, 'L’application, en direct', {
    x: L, y: 2.0, w: 7.0, h: 0.9, fontSize: 40, bold: true, color: C.contenu,
  });
  texte(s, 'smartroommanager.vercel.app', {
    x: L, y: 2.95, w: 6.5, h: 0.4, fontSize: 15, fontFace: MONO, color: C.accent,
  });

  const parcours = [
    'Le tunnel de réservation, du besoin à la confirmation',
    'Le classement des salles et son explication',
    'L’espace d’administration et le cloisonnement des permissions',
    'L’assistant : « Où se trouve la salle Hopper ? »',
  ];
  parcours.forEach((t, i) => {
    const y = 3.75 + i * 0.62;
    s.addShape(pres.ShapeType.ellipse, {
      x: L, y: y + 0.05, w: 0.26, h: 0.26,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    texte(s, t, {
      x: L + 0.46, y, w: 6.3, h: 0.35, fontSize: 14, color: C.contenu,
    });
  });

  s.addImage({
    path: path.join(CAPT, '08-assistant.png'),
    x: 7.6, y: 1.35, w: 5.0, h: 3.13,
    sizing: { type: 'contain', w: 5.0, h: 3.13 },
  });
  texte(s, 'Capture de secours — l’assistant répond en production, journal du tour : repli = false.', {
    x: 7.6, y: 4.6, w: 5.0, h: 0.6, fontSize: 11.5, italic: true, color: C.faint, lineSpacing: 16,
  });

  s.addShape(pres.ShapeType.ellipse, {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fill: { color: C.surface2 }, line: { color: C.surface2 },
  });
  texte(s, String(numero), {
    x: 12.35, y: 6.72, w: 0.4, h: 0.4,
    fontSize: 11, bold: true, color: C.muted, align: 'center', valign: 'middle',
  });

  s.addNotes(
    'BASCULER SUR LE NAVIGATEUR. Ouvrir l’onglet déjà chargé et déjà connecté — le service ' +
    'gratuit s’endort après quinze minutes et met environ 50 secondes à se réveiller. ' +
    'Si la connexion tarde malgré tout, commenter la capture de droite et poursuivre. ' +
    'Quatre minutes maximum, puis revenir au diaporama.',
  );
}

/* ══════════════════════════════ 15 — TESTS ══ */
{
  const s = slide({
    surTitre: '11 — Qualité',
    titre: 'Cinq niveaux de tests, et une discipline de preuve',
    notes: 'La contre-épreuve qui a invalidé un correctif est l’anecdote à raconter : le ' +
      'formateur avait replié l’expression sur trois lignes, et le remplacement ne s’appliquait plus.',
  });

  chiffre(s, { x: L, y: 1.8, w: 2.7, valeur: '1 576', libelle: 'tests automatisés' });
  chiffre(s, { x: L + 2.9, y: 1.8, w: 2.7, valeur: '1 103', libelle: 'back-end' });
  chiffre(s, { x: L + 5.8, y: 1.8, w: 2.7, valeur: '474', libelle: 'front-end' });
  chiffre(s, { x: L + 8.7, y: 1.8, w: 3.1, valeur: '100 %', libelle: 'branches du domaine', couleur: C.vert });

  carte(s, { x: L, y: 3.3, w: 5.6, h: 2.5, fill: C.surface });
  texte(s, 'Ce que les tests ont réellement attrapé', {
    x: L + 0.3, y: 3.55, w: 5.0, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  puces(s, [
    'Une dépendance épinglée à la mauvaise version : la production aurait servi une API cassée',
    'Un piège de fuseau horaire qui vidait une page sur 608 réservations',
    'Une exclusion d’anonymisation qui ne servait à rien',
  ], { x: L + 0.3, y: 4.0, w: 5.0, h: 1.65, fontSize: 12.5 });

  carte(s, { x: L + 6.0, y: 3.3, w: 5.83, h: 2.5, fill: C.accentSombre });
  texte(s, 'Un test qui ne peut pas échouer ne prouve rien', {
    x: L + 6.3, y: 3.55, w: 5.23, h: 0.32, fontSize: 15, bold: true, color: C.accent,
  });
  texte(s, 'Chaque correctif est accompagné d’une contre-épreuve : on vérifie que le test échoue bien lorsqu’on retire le correctif.\n\nCette pratique a invalidé un correctif que nous croyions bon — le formateur avait replié l’expression, et le remplacement ne s’appliquait plus.', {
    x: L + 6.3, y: 4.0, w: 5.23, h: 1.65, fontSize: 12.5, color: C.contenu, lineSpacing: 18,
  });
}

/* ══════════════════════════════ 16 — DIFFICULTÉS ══ */
{
  const s = slide({
    surTitre: '12 — Difficultés',
    titre: 'Quand le symptôme désigne le mauvais coupable',
    notes: 'Choisir un seul incident à raconter en détail selon le temps restant. ' +
      'Celui du cache est le plus parlant pour un jury non technique.',
  });

  const inc = [
    ['Statistiques identiques sur deux comptes', 'Le cache navigateur est indexé par URL, et /stats/me est la même URL pour tous. La directive « private » n’y change rien.', C.rouge],
    ['Connexion refusée sur « mot de passe »', 'Le mode TLS manquait. libpq se rabat en clair, l’hébergeur refuse, et son message parle de mot de passe.', C.ambre],
    ['Six défauts invisibles en local', 'Ils vivaient tous sur le chemin distant de l’assistant, qui ne s’exécute qu’en production.', C.accent],
  ];
  inc.forEach(([titre, corps, couleur], i) => {
    const y = 1.9 + i * 1.2;
    s.addShape(pres.ShapeType.ellipse, {
      x: L, y: y + 0.08, w: 0.3, h: 0.3,
      fill: { color: couleur }, line: { color: couleur },
    });
    texte(s, titre, {
      x: L + 0.5, y, w: 4.3, h: 0.5, fontSize: 15, bold: true, color: C.contenu, lineSpacing: 21,
    });
    texte(s, corps, {
      x: L + 5.0, y: y + 0.02, w: 6.8, h: 1.0, fontSize: 12.5, color: C.muted, lineSpacing: 18,
    });
  });

  // Le cadre reste au-dessus de la pastille de numéro, à 6.72.
  carte(s, { x: L, y: 5.62, w: LARG, h: 0.95, fill: C.surface2 });
  texte(s, 'L’enseignement commun : un journal qui dit qu’il a échoué sans dire pourquoi coûte des heures. Le même défaut est apparu trois fois, à trois endroits différents.', {
    x: L + 0.32, y: 5.82, w: LARG - 0.9, h: 0.6, fontSize: 13, italic: true, color: C.contenu,
    lineSpacing: 19,
  });
}

/* ══════════════════════════════ 17 — DÉPLOIEMENT ══ */
{
  const s = slide({
    surTitre: '13 — Déploiement',
    titre: 'En ligne, supervisé, à coût nul',
    notes: 'Assumer les quatre limites : elles tiennent au palier gratuit, pas à la conception. ' +
      'La dégradation propre est ce qui les rend supportables.',
  });

  const services = [
    ['Neon', 'PostgreSQL 18 managé, avec pgvector'],
    ['Render', 'API en image Docker, migrations au démarrage'],
    ['Vercel', 'Front statique et réécritures vers l’API'],
    ['UptimeRobot', 'Sonde toutes les cinq minutes'],
  ];
  services.forEach(([nom, role], i) => {
    const y = 1.8 + i * 0.78;
    carte(s, { x: L, y, w: 5.6, h: 0.64, fill: C.surface });
    texte(s, nom, {
      x: L + 0.28, y: y + 0.17, w: 1.7, h: 0.3, fontSize: 13.5, bold: true, color: C.accent,
    });
    texte(s, role, {
      x: L + 1.95, y: y + 0.17, w: 3.5, h: 0.3, fontSize: 12, color: C.muted,
    });
  });

  carte(s, { x: L + 6.0, y: 1.8, w: 5.83, h: 3.1, fill: C.surface });
  texte(s, 'Quatre limites assumées', {
    x: L + 6.3, y: 2.05, w: 5.23, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  puces(s, [
    'Réveil à froid d’environ 50 secondes',
    'Disque éphémère — les médias sont versionnés',
    'Limiteur de connexion à cinq par minute',
    'Quota quotidien du modèle distant',
  ], { x: L + 6.3, y: 2.5, w: 5.23, h: 1.6, fontSize: 12.5 });
  texte(s, 'Toutes tiennent au palier gratuit, aucune à la conception.', {
    x: L + 6.3, y: 4.3, w: 5.23, h: 0.4, fontSize: 12, italic: true, color: C.faint,
  });

  carte(s, { x: L, y: 5.15, w: LARG, h: 1.0, fill: C.accentSombre });
  texte(s, 'La dégradation reste propre', {
    x: L + 0.32, y: 5.32, w: 5.0, h: 0.3, fontSize: 14, bold: true, color: C.accent,
  });
  texte(s, 'Quota épuisé, l’assistant retombe sur son moteur déterministe et continue de répondre. L’étage distant est un confort, pas une dépendance.', {
    x: L + 0.32, y: 5.68, w: LARG - 0.64, h: 0.4, fontSize: 13, color: C.contenu,
  });
}

/* ══════════════════════════════ 18 — BILAN ══ */
{
  const s = slide({
    surTitre: '14 — Bilan',
    titre: 'Ce que le projet nous a appris',
    notes: 'Ces trois enseignements sont les nôtres, pas des généralités : chacun renvoie à un ' +
      'incident précis que nous pouvons raconter si on nous le demande.',
  });

  const lecons = [
    ['Mesurer avant d’affirmer', 'Plusieurs diagnostics initiaux se sont révélés faux. À chaque fois, c’est une mesure qui a tranché — et souvent une mesure qu’il a d’abord fallu rendre possible.'],
    ['Un journal muet coûte des heures', 'Le même défaut est apparu trois fois. La correction fut identique : joindre la cause, sans jamais joindre le secret.'],
    ['Ce qui ne s’exécute que d’un côté n’est pas testé', 'Six défauts vivaient dans le chemin distant de l’assistant. Le déploiement est un environnement d’exécution à part entière.'],
  ];
  lecons.forEach(([titre, corps], i) => {
    const x = L + i * 4.02;
    carte(s, { x, y: 1.78, w: 3.72, h: 2.9 });
    texte(s, titre, {
      x: x + 0.3, y: 2.05, w: 3.12, h: 0.75, fontSize: 15.5, bold: true, color: C.accent, lineSpacing: 21,
    });
    texte(s, corps, {
      x: x + 0.3, y: 2.9, w: 3.12, h: 1.55, fontSize: 12.5, color: C.muted, lineSpacing: 18,
    });
  });

  texte(s, 'Compétences mobilisées', {
    x: L, y: 5.0, w: LARG, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  texte(s, 'Modélisation avancée et contraintes d’intégrité  ·  Concurrence et transactions  ·  Conception d’API  ·  React et accessibilité  ·  Recherche d’information et vectorisation  ·  Intégration de modèles de langage  ·  Qualité logicielle  ·  Déploiement et diagnostic à distance', {
    x: L, y: 5.42, w: LARG, h: 0.9, fontSize: 13, color: C.muted, lineSpacing: 21,
  });
}

/* ══════════════════════════════ 19 — CONCLUSION ══ */
{
  const s = slide({
    surTitre: '15 — Conclusion',
    titre: 'Six objectifs sur sept pleinement atteints',
    notes: 'Le septième — le déploiement — l’est avec des réserves qui tiennent au palier ' +
      'gratuit. Le dire franchement vaut mieux que de le masquer.',
  });

  carte(s, { x: L, y: 1.78, w: 5.6, h: 2.7, fill: C.surface });
  texte(s, 'Ce que nous livrons', {
    x: L + 0.3, y: 2.02, w: 5.0, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  puces(s, [
    'Une garantie d’intégrité portée par la base',
    'Une couche métier pure, prouvée à 100 %',
    'Deux briques Data & IA réellement fonctionnelles',
    'Un déploiement complet, supervisé, gratuit',
  ], { x: L + 0.3, y: 2.48, w: 5.0, h: 1.8, fontSize: 13 });

  carte(s, { x: L + 6.0, y: 1.78, w: 5.83, h: 2.7, fill: C.surface });
  texte(s, 'Perspectives', {
    x: L + 6.3, y: 2.02, w: 5.23, h: 0.32, fontSize: 15, bold: true, color: C.contenu,
  });
  puces(s, [
    'Stockage objet externe pour les médias',
    'Historiser les scores pour évaluer la recommandation sur données réelles',
    'Élargir le catalogue d’outils de l’assistant',
    'Capteurs de présence, là où la validation est déclarative',
  ], { x: L + 6.3, y: 2.48, w: 5.23, h: 1.8, fontSize: 13 });

  carte(s, { x: L, y: 4.78, w: LARG, h: 1.35, fill: C.accentSombre });
  texte(s, 'Le principe qui résume notre travail', {
    x: L + 0.35, y: 5.0, w: 5.5, h: 0.3, fontSize: 13.5, bold: true, color: C.accent,
  });
  texte(s, 'Une garde qui refuse par défaut doit être branchée par défaut. La nôtre était juste — ne rien envoyer à un tiers sans masquer — et son absence de câblage a rendu tout un étage inatteignable pendant des semaines, sans autre signe qu’une ligne de journal.', {
    x: L + 0.35, y: 5.38, w: LARG - 0.7, h: 0.65, fontSize: 13, color: C.contenu, lineSpacing: 19,
  });
}

/* ══════════════════════════════ 20 — MERCI ══ */
{
  numero += 1;
  const s = pres.addSlide({ masterName: 'FOND' });

  texte(s, 'Merci de votre attention', {
    x: L, y: 2.5, w: 11, h: 0.95, fontSize: 44, bold: true, color: C.contenu,
  });
  texte(s, 'Nous répondons à vos questions.', {
    x: L, y: 3.5, w: 9, h: 0.45, fontSize: 17, color: C.muted,
  });

  const liens = [
    ['Application', 'smartroommanager.vercel.app'],
    ['Dépôt', 'github.com/DD542/SmartRoomManager'],
    ['Documentation de l’API', 'smartroom-api-ryya.onrender.com/docs'],
  ];
  liens.forEach(([libelle, url], i) => {
    const y = 4.55 + i * 0.55;
    texte(s, libelle, {
      x: L, y, w: 2.6, h: 0.3, fontSize: 12.5, color: C.faint,
    });
    texte(s, url, {
      x: L + 2.7, y, w: 7.5, h: 0.3, fontSize: 12.5, fontFace: MONO, color: C.accent,
    });
  });

  s.addNotes(
    'Questions probables : pourquoi la contrainte en base plutôt qu’en code ; comment ' +
    'l’assistant évite d’inventer ; ce qui reste à faire ; la répartition réelle du travail ' +
    'dans le groupe. Chacun doit pouvoir justifier son périmètre.',
  );
}

pres.writeFile({ fileName: SORTIE }).then(() => {
  console.log('  ecrit : ' + SORTIE);
  console.log('  slides : ' + numero);
});
