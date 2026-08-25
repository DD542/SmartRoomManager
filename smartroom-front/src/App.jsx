import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthProvider } from './hooks/useAuth';
import { AdminSessionProvider } from './hooks/useAdminSession';
import { ToastProvider } from './hooks/useToast';

/**
 * Fournisseurs globaux montés au-dessus du routeur.
 *
 * Les deux sessions coexistent sans se confondre : `AuthProvider` porte celle de
 * l'espace utilisateur, `AdminSessionProvider` celle de l'administration.
 * Aucun état n'est persisté : tout vit en mémoire React, conformément au cahier.
 */
export default function App() {
  return (
    <AuthProvider>
      <AdminSessionProvider>
        <ToastProvider>
          {/* `v7_startTransition` se déclare ici et non sur le routeur : c'est
              `RouterProvider` qui enveloppe les mises à jour d'état. */}
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </ToastProvider>
      </AdminSessionProvider>
    </AuthProvider>
  );
}
