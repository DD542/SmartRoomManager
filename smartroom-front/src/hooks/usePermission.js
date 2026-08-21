import { useAdminSession } from './useAdminSession';

/**
 * Lecture des permissions de la session courante.
 *
 * `peut(permission)` sert à trois endroits : masquer une entrée de navigation,
 * bloquer une route, désactiver une action ponctuelle dans un écran autorisé.
 */
export function usePermission() {
  const { permissions } = useAdminSession();

  const peut = (permission) => (permission ? permissions.includes(permission) : true);
  const peutTout = (liste = []) => liste.every(peut);
  const peutAuMoinsUne = (liste = []) => liste.some(peut);

  return { permissions, peut, peutTout, peutAuMoinsUne };
}
