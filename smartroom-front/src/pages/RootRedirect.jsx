import { Navigate } from 'react-router-dom';
import { useAdminSession } from '../hooks/useAdminSession';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/ui/States';

/**
 * Point d'entrée de l'application : chacun arrive chez lui.
 *
 * La racine servait une page vitrine, que toute personne déjà connectée devait
 * traverser pour atteindre son travail. Elle mène désormais au tableau de bord
 * correspondant à la session ouverte — l'administration pour un administrateur,
 * l'espace personnel pour un utilisateur, l'écran de connexion pour un visiteur.
 *
 * L'attente de reprise n'est pas un détail : les deux sessions se rétablissent
 * par un appel réseau, et au premier rendu on ne sait pas encore si elles
 * existent. Trancher tout de suite renverrait vers la connexion une personne
 * déjà connectée, qui verrait un formulaire clignoter avant d'être redirigée.
 *
 * L'administration passe avant l'espace utilisateur quand les deux sessions
 * sont ouvertes : y ouvrir une session est un acte délibéré, et la seconde
 * s'obtient d'un lien depuis la première.
 */
export default function RootRedirect() {
  const { isAuthenticated: utilisateur, isRestoring: repriseUtilisateur } = useAuth();
  const { isAuthenticated: administrateur, isRestoring: repriseAdmin } = useAdminSession();

  if (repriseUtilisateur || repriseAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <Spinner label="Ouverture de votre espace" />
      </div>
    );
  }

  if (administrateur) return <Navigate to="/admin" replace />;
  if (utilisateur) return <Navigate to="/app" replace />;
  return <Navigate to="/connexion" replace />;
}
