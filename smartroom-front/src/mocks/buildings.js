/** Référentiel des bâtiments. Miroir de la table `buildings` côté PostgreSQL. */
export const buildings = [
  {
    id: 'b-a',
    code: 'A',
    name: 'Bâtiment A',
    campus: 'Campus Eiffel',
    floors: ['RDC', '1er', '2e'],
    entranceLabel: 'Entrée principale',
    directions: ['Entrée principale', 'Ascenseur B', '2e étage à droite'],
  },
  {
    id: 'b-b',
    code: 'B',
    name: 'Bâtiment B',
    campus: 'Campus Newton',
    floors: ['RDC', '1er', '2e', '3e'],
    entranceLabel: 'Accueil Newton',
    directions: ['Accueil Newton', 'Escalier central', '3e étage aile Est'],
  },
  {
    id: 'b-c',
    code: 'C',
    name: 'Bâtiment C',
    campus: 'Annexe',
    floors: ['RDC', '1er'],
    entranceLabel: 'Entrée annexe',
    directions: ['Entrée annexe', 'Couloir Sud', 'Première porte à gauche'],
  },
];
