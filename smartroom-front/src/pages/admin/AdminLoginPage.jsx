import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Info, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAdminSession } from '../../hooks/useAdminSession';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, Callout } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Form';

/**
 * A-00 — Connexion à l'espace d'administration.
 * Distincte de la connexion utilisateur : un compte étudiant n'y accède pas, et
 * l'écran annonce que toute tentative est journalisée.
 */
export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAdminSession();

  const [form, setForm] = useState({ email: '', password: '' });
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = 'Connexion administrateur — SmartRoom Manager';
  }, []);

  const destination = location.state?.from ?? '/admin';
  if (isAuthenticated) return <Navigate to={destination} replace />;

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(form);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
            <ShieldCheck size={22} aria-hidden="true" className="text-accent" />
          </span>
          <div>
            <p className="text-xl font-semibold text-content">SmartRoom Manager</p>
            <Badge tone="success" className="mt-1.5">
              Administration
            </Badge>
          </div>
        </header>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Adresse email"
              type="email"
              autoComplete="email"
              icon={Mail}
              required
              placeholder="prenom.nom@ece.fr"
              value={form.email}
              onChange={(event) => {
                setForm((current) => ({ ...current, email: event.target.value }));
                setError(null);
              }}
            />

            <Field label="Mot de passe" htmlFor="mot-de-passe-admin" required>
              <div className="relative">
                <Lock
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
                />
                <input
                  id="mot-de-passe-admin"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, password: event.target.value }));
                    setError(null);
                  }}
                  className="h-10 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-10 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setVisible((current) => !current)}
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={visible}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-content-muted transition hover:text-content"
                >
                  {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </Field>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-content"
              >
                <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
                {error}
              </p>
            )}

            <Button type="submit" size="lg" fullWidth loading={pending} iconRight={ArrowRight}>
              Se connecter
            </Button>
          </form>

          <Callout tone="info" icon={Info} className="mt-5">
            Accès réservé aux comptes administrateurs. Toute connexion est journalisée.
          </Callout>

          <Callout tone="info" className="mt-3">
            Comptes de démonstration, mot de passe{' '}
            <span className="font-mono text-content">smartroom2026</span> :{' '}
            <span className="font-mono text-content">d.menga@ece.fr</span> (toutes permissions),{' '}
            <span className="font-mono text-content">s.boukehila@ece.fr</span> (salles, aide,
            conflits) ou <span className="font-mono text-content">c.nkoulou@ece.fr</span> (aide et
            conflits).
          </Callout>
        </Card>
      </div>
    </div>
  );
}
