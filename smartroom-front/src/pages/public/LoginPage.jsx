import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field, Input } from '../../components/ui/Form';
import { Card, Callout } from '../../components/ui/Card';
import { BoutonGoogle } from '../../components/auth/BoutonGoogle';

/**
 * P-02 — Connexion.
 * Quatre états couverts : saisie, envoi en cours, erreur d'authentification,
 * succès (redirection vers la page demandée ou vers l'accueil).
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { login, loginWithGoogle, isAuthenticated } = useAuth();

  const [form, setForm] = useState({ email: '', password: '', remember: false });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    document.title = 'Connexion — SmartRoom Manager';
  }, []);

  const target = location.state?.from ?? '/app';
  if (isAuthenticated) return <Navigate to={target} replace />;

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setError(null);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending('mot-de-passe');
    setError(null);
    try {
      const user = await login(form);
      toast.success('Connexion réussie', `Bienvenue, ${user.firstName}.`);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  /**
   * Le jeton rendu par Google, échangé contre une session.
   *
   * Un compte inconnu est créé par le serveur : c'est le propre d'une
   * connexion déléguée, et c'est pourquoi il n'y a pas de second bouton
   * « créer un compte ». Un nouveau venu part remplir ses préférences, un
   * habitué revient là où il allait.
   */
  const onGoogle = async (credential) => {
    setPending('google');
    setError(null);
    try {
      const resultat = await loginWithGoogle(credential);
      toast.success(
        resultat.created ? 'Compte créé' : 'Connexion réussie',
        `Bienvenue, ${resultat.user.firstName}.`,
      );
      navigate(resultat.firstLogin ? '/bienvenue' : target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="p-6">
      <header className="text-center">
        <h1 className="text-xl font-semibold text-content">Connexion</h1>
        <p className="mt-1 text-sm text-content-muted">Accédez à votre espace de réservation</p>
      </header>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label="Adresse email"
          type="email"
          name="email"
          autoComplete="email"
          icon={Mail}
          required
          placeholder="prenom.nom@edu.ece.fr"
          value={form.email}
          onChange={set('email')}
        />

        <Field label="Mot de passe" htmlFor="mot-de-passe" required>
          <div className="relative">
            <Lock
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
            />
            <input
              id="mot-de-passe"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={form.password}
              onChange={set('password')}
              className="h-10 w-full rounded-xl border border-line bg-surface-raised pl-9 pr-10 text-sm text-content
                         placeholder:text-content-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              aria-pressed={showPassword}
              // 28 px mesures : sous les 44 px exiges, et c'est la commande
              // qu'on cherche du pouce quand le mot de passe part de travers.
              // La zone est etendue par un pseudo-element, le bouton garde sa
              // taille dans le champ.
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-content-muted transition after:absolute after:-inset-2 after:content-[''] hover:text-content"
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            label="Se souvenir de moi"
            checked={form.remember}
            onChange={(checked) => setForm((current) => ({ ...current, remember: checked }))}
          />
          <Link
            to="/mot-de-passe-oublie"
            // `py-3` : mesure a 16 px de haut, ce lien est une commande du
            // formulaire et non un mot dans une phrase — l'exception des liens
            // en ligne de WCAG 2.5.5 ne s'y applique pas.
            className="inline-flex min-h-[44px] items-center py-3 text-xs font-medium text-accent transition hover:text-accent-hover"
          >
            Mot de passe oublié ?
          </Link>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-content"
          >
            <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            {error}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={pending === 'mot-de-passe'}>
          Se connecter
        </Button>
      </form>

      {/* Le séparateur « ou » appartient au bouton : sans connexion Google
          configurée, il n'introduirait rien. */}
      <BoutonGoogle
        onCredential={onGoogle}
        onError={setError}
        disabled={pending !== null}
      />

      {/* Les comptes de démonstration et leur mot de passe ont été retirés :
          le développement est terminé, et sur une instance ouverte ils
          donneraient des identifiants valables à qui atteint la page.

          Les deux phrases restantes ne sont pas des identifiants. La seconde
          décrit ce que fait l'application quand un compte Google inconnu se
          présente — c'est une information à donner avant le clic, pas une
          commodité de développement. */}
      <Callout tone="info" className="mt-5">
        L’espace d’administration a sa propre connexion : s’authentifier ici n’y donne pas accès.
        Un compte Google inconnu ouvre un compte SmartRoom, sans autre formalité.
      </Callout>
    </Card>
  );
}
