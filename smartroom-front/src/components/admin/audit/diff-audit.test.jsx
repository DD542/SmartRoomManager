/**
 * @vitest-environment jsdom
 *
 * Le journal d'audit doit dire **ce qui a changé**.
 *
 * C'est sa raison d'être : une entrée « Modification » qui ne montre pas la
 * valeur d'avant et celle d'après ne rend pas l'arbitrage opposable, elle dit
 * seulement que quelqu'un a touché à quelque chose.
 *
 * Le bloc ne s'affichait jamais. Deux couches nommaient la même chose
 * différemment : l'adaptateur produit `entry.before` et `entry.after`, le
 * composant lisait `entry.diff?.before` et `entry.diff?.after`. `entry.diff`
 * vaut `undefined`, l'optionnel absorbe, le repli donne un objet vide — et la
 * section se rend sans une ligne, sans une erreur.
 *
 * Les 91 entrées de la base portaient pourtant toutes un `diff_before` et un
 * `diff_after`.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditDetail } from './AuditDetail';
import * as adapt from '../../../api/adapters';

/** Une entrée telle que l'adaptateur la produit, depuis la charge de l'API. */
const ENTREE = adapt.auditEntry({
  id: 'au-1',
  actor_label: 'Dylan Menga',
  actor_admin_id: 'ad-1',
  action: 'modification',
  target_type: 'room',
  target_label: 'Salle Curie',
  target_id: 'r-1',
  diff_before: { Capacité: '12', 'Badge requis': 'non' },
  diff_after: { Capacité: '20', 'Badge requis': 'oui' },
  ip_address: '127.0.0.1',
  session_id: '85c1ce70',
  flagged_at: null,
  flag_reason: null,
  occurred_at: '2026-09-01T12:21:44Z',
});

describe('Ce qui a changé', () => {
  it('montre la valeur d’avant et celle d’après', () => {
    render(<AuditDetail entry={ENTREE} onFlag={vi.fn()} />);

    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('non')).toBeTruthy();
    expect(screen.getByText('oui')).toBeTruthy();
  });

  it('nomme chaque champ touché', () => {
    render(<AuditDetail entry={ENTREE} onFlag={vi.fn()} />);

    expect(screen.getByText('Capacité')).toBeTruthy();
    expect(screen.getByText('Badge requis')).toBeTruthy();
  });

  it('supporte un champ apparu ou disparu', () => {
    // Une émission de code ajoute « Émis le » sans qu'il existât avant : le
    // tableau doit garder la colonne et laisser l'autre vide, plutôt que
    // d'omettre la ligne.
    const emission = adapt.auditEntry({
      id: 'au-2',
      action: 'modification',
      target_label: 'Salle Curie',
      diff_before: { "Code d'accès": 'E-****' },
      diff_after: { "Code d'accès": 'E-****', 'Émis le': '2026-09-01T12:21:44Z' },
      occurred_at: '2026-09-01T12:21:44Z',
    });

    render(<AuditDetail entry={emission} onFlag={vi.fn()} />);

    expect(screen.getByText('Émis le')).toBeTruthy();
  });

  it('ne montre rien quand rien n’a changé', () => {
    // Une connexion ne modifie aucun champ : la section n'a pas à s'inventer
    // un contenu.
    const connexion = adapt.auditEntry({
      id: 'au-3',
      action: 'connexion',
      target_label: 'Dylan Menga',
      diff_before: null,
      diff_after: null,
      occurred_at: '2026-09-01T12:21:44Z',
    });

    const { container } = render(<AuditDetail entry={connexion} onFlag={vi.fn()} />);

    expect(container.textContent).not.toContain('Capacité');
  });
});
