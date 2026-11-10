import { describe, expect, it } from 'vitest';
import { destinationSure } from './destination';

describe('destination après connexion', () => {
  it('garde un chemin interne de l’espace, requête comprise', () => {
    expect(destinationSure('/app/aide?article=ha-11', '/app')).toBe('/app/aide?article=ha-11');
    expect(destinationSure('/app', '/app')).toBe('/app');
  });

  it.each([
    ['//pirate.example', 'adresse externe sans protocole'],
    ['/\\pirate.example', 'barre oblique inversée (CVE-2025-68470)'],
    ['https://pirate.example', 'adresse absolue'],
    ['/admin/utilisateurs', 'autre espace'],
    ['/application', 'faux préfixe'],
    [undefined, 'rien'],
  ])('refuse %s (%s)', (candidate) => {
    expect(destinationSure(candidate, '/app')).toBe('/app');
  });
});
