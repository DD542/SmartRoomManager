/**
 * Destination de retour après connexion, réduite à l'espace attendu.
 *
 * Elle vient de l'état du routeur, posé par les gardes de l'application —
 * pas de l'adresse. Mais React Router 6 interprète `/\exemple.com` comme une
 * adresse externe (CVE-2025-68470) : si une destination devait un jour venir
 * d'ailleurs, elle pourrait renvoyer un utilisateur fraîchement connecté vers
 * un faux site. On n'accepte donc qu'un chemin interne, dans l'espace donné.
 */
export function destinationSure(candidate, espace, repli = espace) {
  if (typeof candidate !== 'string') return repli;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return repli;
  // eslint-disable-next-line no-control-regex
  if (candidate.includes('\\') || /[\u0000-\u001f]/.test(candidate)) return repli;
  if (candidate !== espace && !candidate.startsWith(`${espace}/`) && !candidate.startsWith(`${espace}?`)) {
    return repli;
  }
  return candidate;
}
