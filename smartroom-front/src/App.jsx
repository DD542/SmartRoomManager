import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';

/**
 * Fournisseurs globaux montés au-dessus du routeur.
 * Aucun état n'est persisté : tout vit en mémoire React, conformément au cahier.
 */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
