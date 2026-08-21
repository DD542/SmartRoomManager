import { useEffect } from 'react';

const SUFFIXE = 'SmartRoom Manager';

/**
 * Fixe le titre de l'onglet, seul repère de navigation dans un historique de
 * navigateur. Les écrans d'administration en comptent seize : la règle est
 * portée ici plutôt que recopiée dans chaque page.
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} — ${SUFFIXE}`;
  }, [title]);
}
