import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ToastViewport } from '../components/ui/Toast';

const ToastContext = createContext(null);

let counter = 0;

/**
 * File de messages éphémères. Chaque action de l'utilisateur reçoit un retour
 * visuel immédiat : création, modification, annulation, erreur d'API.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = `toast-${(counter += 1)}`;
      const entry = { id, tone: 'info', duration: 4000, ...toast };
      setToasts((current) => [...current, entry]);
      if (entry.duration > 0) {
        setTimeout(() => dismiss(id), entry.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toasts,
      dismiss,
      toast: push,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'danger', title, description }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
    }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé dans un ToastProvider.');
  return context;
}
