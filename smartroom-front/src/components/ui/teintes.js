/**
 * Les six teintes lumineuses, déclinées en classes complètes.
 *
 * Écrites en toutes lettres et non composées (`bg-aurore-${teinte}/15`) :
 * Tailwind ne génère que les classes qu'il lit dans le code source, et une
 * classe assemblée à l'exécution n'existerait pas dans la feuille de style.
 */
export const TEINTES = {
  bleu: {
    pastille: 'bg-aurore-bleu/15 text-aurore-bleu',
    texte: 'text-aurore-bleu',
    halo: 'bg-aurore-bleu/40',
  },
  violet: {
    pastille: 'bg-aurore-violet/15 text-aurore-violet',
    texte: 'text-aurore-violet',
    halo: 'bg-aurore-violet/40',
  },
  rose: {
    pastille: 'bg-aurore-rose/15 text-aurore-rose',
    texte: 'text-aurore-rose',
    halo: 'bg-aurore-rose/40',
  },
  cyan: {
    pastille: 'bg-aurore-cyan/15 text-aurore-cyan',
    texte: 'text-aurore-cyan',
    halo: 'bg-aurore-cyan/40',
  },
  ambre: {
    pastille: 'bg-aurore-ambre/15 text-aurore-ambre',
    texte: 'text-aurore-ambre',
    halo: 'bg-aurore-ambre/40',
  },
  emeraude: {
    pastille: 'bg-aurore-emeraude/15 text-aurore-emeraude',
    texte: 'text-aurore-emeraude',
    halo: 'bg-aurore-emeraude/40',
  },
};

/** Teinte d'un rang dans une liste : les éléments voisins ne se répètent pas. */
export const teinteDuRang = (rang) => {
  const ordre = ['bleu', 'violet', 'rose', 'cyan', 'ambre', 'emeraude'];
  return TEINTES[ordre[rang % ordre.length]];
};
