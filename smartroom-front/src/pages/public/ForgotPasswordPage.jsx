import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Info, Mail, Send } from 'lucide-react';
import { forgotPassword } from '../../api/auth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Form';
import { Card, Callout } from '../../components/ui/Card';

/**
 * P-03 — Mot de passe oublié.
 * États : saisie, envoi, erreur de validation, confirmation d'envoi.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('saisie');
  const [error, setError] = useState(null);
  const [expiresInMin, setExpiresInMin] = useState(30);

  useEffect(() => {
    document.title = 'Mot de passe oublié — SmartRoom Manager';
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setStatus('envoi');
    setError(null);
    try {
      const result = await forgotPassword(email);
      setExpiresInMin(result.expiresInMin);
      setStatus('envoye');
    } catch (err) {
      setError(err.message);
      setStatus('saisie');
    }
  };

  if (status === 'envoye') {
    return (
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-success/40 bg-success-soft">
          <CheckCircle2 size={20} aria-hidden="true" className="text-success" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-content">Lien envoyé</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-content-muted">
          Si un compte est associé à <span className="font-mono text-content">{email}</span>, un lien
          de réinitialisation vient d’être envoyé. Il reste valable{' '}
          <span className="font-mono text-content">{expiresInMin} min</span>.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button to="/connexion" size="lg" fullWidth icon={ArrowLeft}>
            Retour à la connexion
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus('saisie');
              setError(null);
            }}
          >
            Utiliser une autre adresse
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <header>
        <h1 className="text-xl font-semibold text-content">Mot de passe oublié</h1>
        <p className="mt-1 text-sm leading-relaxed text-content-muted">
          Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label="Adresse email institutionnelle"
          type="email"
          name="email"
          autoComplete="email"
          icon={Mail}
          required
          placeholder="prenom.nom@edu.ece.fr"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          error={error}
        />

        <Callout tone="info" icon={Info}>
          Le lien reçu est à usage unique et expire au bout de 30 minutes.
        </Callout>

        <Button type="submit" size="lg" fullWidth icon={Send} loading={status === 'envoi'}>
          Envoyer le lien
        </Button>
        <Button to="/connexion" variant="secondary" size="lg" fullWidth icon={ArrowLeft}>
          Retour à la connexion
        </Button>
      </form>
    </Card>
  );
}
