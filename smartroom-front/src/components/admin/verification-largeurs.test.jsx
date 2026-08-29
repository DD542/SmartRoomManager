/**
 * @vitest-environment jsdom
 *
 * Vérification finale : les surfaces de l'administration, à huit largeurs et
 * dans leurs quatre états.
 *
 * jsdom ne calcule aucune mise en page : ce fichier ne mesure donc pas les
 * débordements — cela demande un vrai navigateur et une session ouverte. Il
 * vérifie ce qu'il peut vraiment vérifier, et qu'aucune relecture ne garantit :
 * que chaque surface se monte à chaque largeur, dans chaque état, **sans un
 * seul avertissement React**. Clé manquante, valeur nulle sur un champ
 * contrôlé, imbrication invalide, composant déclaré pendant le rendu : tout
 * cela passe la compilation, passe la relecture, et se voit ici.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminSessionContext } from '../../hooks/useAdminSession';
import { AuditTable } from './audit/AuditTable';
import { BookingsTable } from './bookings/BookingsTable';
import { BulkActionBar } from './BulkActionBar';
import { DetailPanel } from './DetailPanel';
import { FilterBar } from './FilterBar';
import { AdminNav } from './AdminSidebar';
import { PermissionMatrix } from './people/PermissionMatrix';
import { PileInspecteur } from './PileInspecteur';
import { PlanEditor } from './rooms/PlanEditor';
import { RoomsTable } from './rooms/RoomsTable';
import { SaveBar } from './SaveBar';
import { TableSkeleton } from './TableSkeleton';
import { UsersTable } from './people/UsersTable';

/** Les huit largeurs du cahier des charges. */
const LARGEURS = [360, 390, 768, 834, 1024, 1280, 1440, 1920];

const largeur = (px) => {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? px <= Number(max[1]) : min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
};

/** Table factice : l'état d'un écran de liste, sans réseau. */
const fauxTable = (rows) => ({
  rows,
  page: 1,
  pageCount: 1,
  total: rows.length,
  pageSize: 10,
  setPage: vi.fn(),
  selection: [],
  basculerLigne: vi.fn(),
  basculerPage: vi.fn(),
  basculerTri: vi.fn(),
  toutesSelectionnees: false,
  sort: null,
});

const SALLE = {
  id: 'r-1',
  name: 'Salle Curie',
  buildingName: 'Eiffel 6',
  floor: '2e étage',
  area: 32,
  capacity: 12,
  status: 'disponible',
  occupancyRate: 0.42,
  equipment: [],
  equipmentCount: 0,
  bookingCount: 7,
  badgeRequired: true,
  accessible: true,
};

const COMPTE = {
  id: 'u-1',
  name: 'Dylan Menga',
  email: 'd.menga@ece.fr',
  promotion: 'B3',
  department: 'Direction',
  bookings: 14,
  noShowRate: 0.05,
  reliabilityScore: 92,
  remainingCreditsH: 6,
  quotaHours: 12,
  status: 'actif',
};

const RESERVATION = {
  id: 'bk-1',
  title: 'Point projet',
  roomName: 'Salle Curie',
  ownerName: 'Dylan Menga',
  start: new Date('2026-09-02T08:00:00Z'),
  end: new Date('2026-09-02T09:00:00Z'),
  status: 'confirmee',
  source: 'utilisateur',
  attendance: 'attendue',
};

const ACTION = {
  id: 'a-1',
  at: new Date('2026-09-01T10:00:00Z'),
  authorName: 'Marie Laurent',
  action: 'modification',
  target: 'Salle Curie',
  ip: '10.0.0.1',
  flagged: false,
};

const COLONNES = [
  { key: 'name', label: 'Salle', priority: 'primary' },
  { key: 'floor', label: 'Étage', priority: 'secondary' },
  { key: 'updatedAt', label: 'Modifiée le', priority: 'tertiary' },
];

const PLAN = {
  label: 'Eiffel 1 — 2e étage',
  document: null,
  placed: [{ room: { id: 'r-1', name: 'Salle Curie', plan: { x: 10, y: 10, w: 20, h: 15 } } }],
};

const PROFILS = {
  proprietaire: [
    'data.export',
    'conflicts.arbitrate',
    'rooms.manage',
    'rules.configure',
    'users.manage',
    'system.configure',
    'support.handle',
  ],
  support: ['support.handle'],
};

/** Enveloppe minimale : routeur et session, ce que toute surface d'admin suppose. */
const enveloppe = (element, permissions = PROFILS.proprietaire) => (
  // Les drapeaux de la version 7, comme dans le routeur de l'application : sans
  // eux, `MemoryRouter` émet deux avertissements de migration que ce test
  // compterait comme des défauts du produit. Ils viennent du harnais.
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AdminSessionContext.Provider
      value={{
        admin: { firstName: 'Dylan', lastName: 'Menga', role: 'Direction' },
        permissions,
        status: 'connecte',
        isAuthenticated: true,
        logout: vi.fn(),
      }}
    >
      {element}
    </AdminSessionContext.Provider>
  </MemoryRouter>
);

/**
 * Les surfaces, avec leurs quatre états.
 *
 * « Chargement » est le squelette, « vide » la liste sans ligne, « erreur »
 * l'écran de refus rendu par la page — représenté ici par le panneau vide, qui
 * est ce que voit l'utilisateur quand rien n'a pu être chargé — et « nominal »
 * les données présentes.
 */
const SURFACES = [
  ['A-03 Salles · nominal', () => <RoomsTable table={fauxTable([SALLE])} />],
  ['A-03 Salles · vide', () => <RoomsTable table={fauxTable([])} />],
  ['A-03 Salles · chargement', () => <TableSkeleton columns={COLONNES} selectable />],
  ['A-10 Utilisateurs · nominal', () => <UsersTable table={fauxTable([COMPTE])} />],
  ['A-10 Utilisateurs · vide', () => <UsersTable table={fauxTable([])} />],
  ['A-16 Journal · nominal', () => <AuditTable table={fauxTable([ACTION])} />],
  ['A-18 Réservations · nominal', () => <BookingsTable table={fauxTable([RESERVATION])} selectedId="bk-1" />],
  [
    'A-11 Matrice · nominal',
    () => (
      <PermissionMatrix
        groups={[{ id: 'g', label: 'Espaces', permissions: [{ id: 'rooms.manage', label: 'Gérer les salles' }] }]}
        admins={[{ id: 'a-1', firstName: 'Dylan', lastName: 'Menga', permissions: [], owner: false }]}
        onToggle={vi.fn()}
      />
    ),
  ],
  ['A-06 Éditeur · nominal', () => <PlanEditor layout={PLAN} onSelect={vi.fn()} onMove={vi.fn()} onCommit={vi.fn()} />],
  [
    'Filtres · avec sélection',
    () => (
      <FilterBar
        filters={[{ id: 'f', label: 'Bâtiment', value: null, onChange: vi.fn(), options: [{ value: 'b', label: 'Eiffel 1' }] }]}
        active={[{ key: 'f', label: 'Eiffel 1', remove: vi.fn() }]}
        onReset={vi.fn()}
      />
    ),
  ],
  [
    'Actions groupées',
    () => (
      <BulkActionBar
        count={3}
        label="salle sélectionnée"
        labelPlural="salles sélectionnées"
        actions={[{ id: 'a', label: 'Archiver', onClick: vi.fn() }]}
        onClear={vi.fn()}
      />
    ),
  ],
  ['Barre d’enregistrement', () => <SaveBar dirty onCancel={vi.fn()} onSave={vi.fn()} />],
  [
    'Détail · rempli',
    () => (
      <DetailPanel title="Salle Curie" onClose={vi.fn()}>
        <p>contenu</p>
      </DetailPanel>
    ),
  ],
  ['Détail · vide', () => <DetailPanel emptyTitle="Aucune sélection" onClose={vi.fn()} />],
  [
    'Pile liste / détail',
    () => <PileInspecteur liste={<p>liste</p>} detail={<p>détail</p>} actif onRetour={vi.fn()} />,
  ],
  ['Navigation · propriétaire', () => <AdminNav />],
];

let plaintes = [];

beforeEach(() => {
  plaintes = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => plaintes.push(String(args[0])));
  vi.spyOn(console, 'warn').mockImplementation((...args) => plaintes.push(String(args[0])));
});

afterEach(() => vi.restoreAllMocks());

describe('Surfaces de l’administration aux huit largeurs', () => {
  LARGEURS.forEach((px) => {
    describe(`${px} px`, () => {
      it.each(SURFACES)('%s se monte sans avertissement', (_nom, fabriquer) => {
        largeur(px);
        const { unmount } = render(enveloppe(fabriquer()));
        unmount();

        expect(plaintes).toEqual([]);
      });
    });
  });
});

describe('Deux profils de permissions, à chaque largeur', () => {
  LARGEURS.forEach((px) => {
    it(`${px} px — la navigation se monte pour les deux profils`, () => {
      largeur(px);

      const { unmount } = render(enveloppe(<AdminNav />, PROFILS.proprietaire));
      unmount();
      const support = render(enveloppe(<AdminNav />, PROFILS.support));
      support.unmount();

      expect(plaintes).toEqual([]);
    });
  });
});
