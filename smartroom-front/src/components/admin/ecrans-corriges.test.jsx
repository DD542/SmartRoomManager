/**
 * Composants d'administration corrigés après ouverture réelle des écrans.
 *
 * Ces défauts ne cassaient ni la compilation ni un import : ils rendaient une
 * page blanche, une case invisible, ou une action irréversible sans garde-fou.
 * Aucun ne se voit dans un diff — tous se voient à l'écran.
 */

import { describe, expect, it, vi } from 'vitest';
// `fireEvent` et non `user-event` : la liste de dépendances du projet est
// arrêtée, et ces interactions — un clic, une saisie — ne demandent pas la
// simulation fine que la seconde apporterait.
import { fireEvent, render, screen, within } from '@testing-library/react';
// Assertions DOM natives plutôt que `jest-dom` : la liste de dépendances du
// projet est arrêtée, et `toBeTruthy` sur un nœud dit la même chose que
// `toBeInTheDocument`.
import { AlternativeList } from './conflicts/AlternativeList';
import { YearOverview } from './rules/YearOverview';
import { UserDetail } from './people/UserDetail';
import { Pill } from '../ui/Badge';
import { KpiTile } from '../stats/KpiTile';
import { SANS_DATE, fmtDate, fmtDateLong, fmtRelative, fmtTime } from '../../utils/dates';

describe('Liste des salles de repli', () => {
  const PROPOSITION = {
    kind: 'autre_salle_meme_creneau',
    roomId: 'r-2',
    score: 88,
    justification: 'Même créneau dans Salle Curie.',
    room: { id: 'r-2', name: 'Salle Curie', capacity: 20 },
  };

  it('affiche le nom et la capacité de la salle proposée', () => {
    // Le composant lit `entree.room.id` : sans la salle résolue, il levait
    // « Cannot read properties of undefined » et emportait l'écran entier.
    render(<AlternativeList alternatives={[PROPOSITION]} />);

    expect(screen.getByText('Salle Curie')).toBeTruthy();
    expect(screen.getByText('88/100')).toBeTruthy();
    expect(screen.getByText(/20 pers/)).toBeTruthy();
  });

  it('reste informative quand aucun gestionnaire de sélection n’est fourni', () => {
    render(<AlternativeList alternatives={[PROPOSITION]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('remonte l’identifiant de la salle choisie, pas celui de la proposition', () => {
    const choisir = vi.fn();
    render(<AlternativeList alternatives={[PROPOSITION]} onSelect={choisir} />);

    fireEvent.click(screen.getByRole('button'));

    expect(choisir).toHaveBeenCalledWith('r-2');
  });

  it('annonce honnêtement l’absence de repli', () => {
    // « Aucune salle disponible » est la bonne réponse quand rien n'est libre
    // sur le créneau : l'arbitre retombe alors sur maintien ou refus.
    render(<AlternativeList alternatives={[]} />);
    expect(screen.getByText(/Aucune salle de repli/)).toBeTruthy();
  });
});

describe('Aperçu annuel des fermetures', () => {
  const JOUR = '2026-03-10';

  const rendre = (nature) =>
    render(
      <YearOverview
        year={2026}
        days={{ [JOUR]: nature }}
        closures={[{ id: 'c-1', label: 'Vacances', from: JOUR, to: JOUR, kind: nature }]}
      />,
    );

  it('teinte la case d’une journée fermée', () => {
    // L'API émet `fermeture` ; le composant mappait `ferme`. `TONS[kind]`
    // valait alors `undefined` : la case gardait le fond de la carte tout en
    // recevant `text-ink`, soit de l'encre sur fond sombre — 1,29:1, invisible.
    // La case marquée porte le motif en `title` : c'est la seule façon de la
    // distinguer des douze grilles mensuelles, où le « 10 » revient partout.
    const { container } = rendre('fermeture');
    const cellule = container.querySelector('[title="Vacances"]');

    expect(cellule).toBeTruthy();
    expect(cellule.className).toContain('bg-danger');
    expect(cellule.className).not.toContain('undefined');
  });

  it('teinte différemment une exception', () => {
    const { container } = rendre('exception');
    const cellule = container.querySelector('[title="Vacances"]');
    expect(cellule.className).toContain('bg-warning');
  });
});

describe('Fiche utilisateur', () => {
  const COMPTE = {
    id: 'u-1',
    firstName: 'Adam',
    lastName: 'David',
    email: 'adam.david@edu.ece.fr',
    promotion: 'B2 Généraliste',
    department: 'Ingénierie',
    badgeNumber: 'B-0042',
    status: 'actif',
    preferences: { weeklyQuotaHours: 12 },
    metrics: {
      bookings: 6,
      noShowRate: 0.2,
      reliabilityScore: 80,
      remainingCreditsH: 6,
      attendanceRate: 0.8,
    },
    recentBookings: [],
  };

  it('exige un motif avant de suspendre', () => {
    // La suspension ferme les sessions ouvertes et bloque toute réservation.
    // Elle partait d'un seul clic, sans confirmation, le motif étant fabriqué
    // par défaut — remplissant le journal d'audit d'entrées interchangeables.
    const suspendre = vi.fn();
    render(<UserDetail user={COMPTE} onStatus={suspendre} onCredits={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Suspendre le compte/ }));

    const modale = screen.getByRole('dialog');
    const valider = within(modale).getByRole('button', { name: 'Suspendre' });
    expect(valider.disabled).toBe(true);
    expect(suspendre).not.toHaveBeenCalled();

    fireEvent.change(within(modale).getByLabelText(/Motif de la décision/), {
      target: { value: 'Trois absences non excusées.' },
    });

    expect(valider.disabled).toBe(false);
    fireEvent.click(valider);
    expect(suspendre).toHaveBeenCalledWith('suspendu', 'Trois absences non excusées.');
  });

  it('laisse renoncer sans rien décider', () => {
    const suspendre = vi.fn();
    render(<UserDetail user={COMPTE} onStatus={suspendre} onCredits={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Suspendre le compte/ }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(suspendre).not.toHaveBeenCalled();
  });
});

describe('Pastille de filtre', () => {
  it('renforce son compteur à l’état actif', () => {
    // `content-faint` sur le fond `accent-soft`, plus clair que la surface, ne
    // donnait que 4:1 — sous le seuil AA. Inactive, le fond reste sombre et la
    // teinte faible passe.
    const { rerender, container } = render(<Pill count={3}>Conflits</Pill>);
    expect(container.querySelector('.text-content-faint')).toBeTruthy();

    rerender(
      <Pill active count={3}>
        Conflits
      </Pill>,
    );
    expect(container.querySelector('.text-content-muted')).toBeTruthy();
    expect(container.querySelector('.text-content-faint')).toBeNull();
  });
});

describe('Formateurs de date', () => {
  it('rend une marque lisible quand la date est absente', () => {
    // Plusieurs colonnes sont nullables et le resteront : une dernière
    // connexion qui n'a jamais eu lieu, une résolution qui n'est pas venue.
    // `format` levait sur la date invalide, et l'exception remontait jusqu'à
    // la frontière d'erreur — un administrateur jamais connecté rendait
    // l'écran des rôles entièrement inaccessible.
    expect(fmtDate(null)).toBe(SANS_DATE);
    expect(fmtDateLong(undefined)).toBe(SANS_DATE);
    expect(fmtRelative(null)).toBe(SANS_DATE);
    expect(fmtTime('')).toBe(SANS_DATE);
  });

  it('formate normalement une date présente', () => {
    expect(fmtDate('2026-08-25T10:00:00Z')).toBe('25/08/2026');
  });

  it('laisse lever sur une valeur malformée', () => {
    // Une valeur absente est un état ; une valeur illisible est un défaut, et
    // la masquer derrière un tiret le rendrait introuvable.
    expect(() => fmtDate('pas une date')).toThrow();
  });
});

describe('Tuile de chiffre clé', () => {
  it('n’abrège pas le libellé qui explique le chiffre', () => {
    // « Occupation moyenne des salles expl… » : la tuile coupait son libellé
    // sur une ligne, et le chiffre ne disait plus de quoi il parlait.
    //
    // L'abrègement est purement visuel — `text-overflow: ellipsis` laisse le
    // texte entier dans le DOM — donc aucune assertion sur le contenu ne peut
    // le voir. Le seul garde-fou mécanique porte sur la classe qui le
    // produisait ; la vérification du rendu s'est faite à l'écran, à 1440 px
    // comme à 375 px.
    render(<KpiTile value="20 %" label="Occupation moyenne des salles exploitables" />);

    const libelle = screen.getByText('Occupation moyenne des salles exploitables');
    expect(libelle.className.split(' ')).not.toContain('truncate');
    expect(libelle.className).not.toMatch(/line-clamp-/);
  });
});
