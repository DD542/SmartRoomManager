/**
 * @vitest-environment jsdom
 *
 * La matrice des permissions compare ce qui est comparable.
 *
 * Une permission s'identifie par son **code** — `rooms.manage` — dans tout le
 * système : `AdminAccountOut.permissions` en rend une liste, `PermissionsIn`
 * en attend une, et `require_permission` en prend un. L'identifiant technique
 * n'existe que dans la base.
 *
 * `listPermissionGroups` exposait pourtant `id: item.id`, l'UUID, et la
 * matrice faisait `admin.permissions.includes(permission.id)` : une liste de
 * codes contre un UUID. **Jamais vrai.** Les vingt-huit cases s'affichaient
 * vides alors que la base portait quinze attributions.
 *
 * Et le clic envoyait ce même UUID à une route qui attend des codes : le
 * serveur refusait, l'écran répondait « Permission inchangée ». L'écran qui
 * gouverne qui peut quoi ne montrait rien et n'écrivait rien.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionMatrix } from './PermissionMatrix';

/** Ce que rend l'API : un identifiant technique **et** un code. */
const GROUPES = [
  {
    id: '3ee6c8b1-8226-4e37-96e3-effae6d7cbf7',
    code: 'espaces',
    label: 'Gestion des espaces',
    permissions: [
      {
        id: '5a7623ea-65d4-4a7f-bb92-281e7c78bb1f',
        code: 'rooms.manage',
        label: 'Gérer les salles',
      },
      {
        id: 'd25d9c5d-ee52-4eb8-b362-001823e46fbf',
        code: 'rules.configure',
        label: 'Configurer les règles',
      },
    ],
  },
];

/** Ce que rend l'API pour un compte : des **codes**. */
const ADMINS = [
  {
    id: 'ad-1',
    firstName: 'Samir',
    lastName: 'Boukehila',
    owner: false,
    permissions: ['rooms.manage'],
  },
];

describe('Matrice des permissions', () => {
  it('coche ce que le compte possède réellement', () => {
    render(<PermissionMatrix groups={GROUPES} admins={ADMINS} onToggle={vi.fn()} />);

    const accordee = screen.getByRole('switch', { name: /Gérer les salles/ });
    expect(accordee.getAttribute('aria-checked')).toBe('true');
  });

  it('laisse vide ce qu’il ne possède pas', () => {
    render(<PermissionMatrix groups={GROUPES} admins={ADMINS} onToggle={vi.fn()} />);

    const absente = screen.getByRole('switch', { name: /Configurer les règles/ });
    expect(absente.getAttribute('aria-checked')).toBe('false');
  });

  it('transmet le code, jamais l’identifiant technique', () => {
    // La route attend des codes. Lui envoyer un UUID la fait refuser, et la
    // liste envoyée remplaçant la matrice entière, un refus vaut mieux qu'une
    // écriture réussie avec la mauvaise valeur.
    const basculer = vi.fn();
    render(<PermissionMatrix groups={GROUPES} admins={ADMINS} onToggle={basculer} />);

    screen.getByRole('switch', { name: /Configurer les règles/ }).click();

    expect(basculer).toHaveBeenCalledWith(ADMINS[0], 'rules.configure', true);
  });

  it('retire bien celle qu’on décoche', () => {
    const basculer = vi.fn();
    render(<PermissionMatrix groups={GROUPES} admins={ADMINS} onToggle={basculer} />);

    screen.getByRole('switch', { name: /Gérer les salles/ }).click();

    expect(basculer).toHaveBeenCalledWith(ADMINS[0], 'rooms.manage', false);
  });
});
