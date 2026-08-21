import { useState } from 'react';
import { MailCheck, Send } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Input } from '../../ui/Form';

/**
 * A-15 — aperçu en direct et envoi de test.
 *
 * L'aperçu applique le même remplacement de variables que l'envoi réel : ce
 * qui s'affiche ici est mot pour mot ce que recevra l'utilisateur.
 */
export function TemplatePreview({ subject, body, onTest, busy = false }) {
  const [email, setEmail] = useState('');
  const valide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader
        title="Aperçu"
        subtitle="Rendu avec un jeu de données d’exemple"
        icon={MailCheck}
      />

      <div className="px-4 pb-4">
        <div className="rounded-xl border border-line bg-ink p-3">
          <p className="border-b border-line pb-2 text-xs text-content-muted">
            Objet : <span className="text-content">{subject || '—'}</span>
          </p>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-content">
            {body || '—'}
          </p>
        </div>

        <div className="mt-4 flex items-end gap-2">
          <Input
            type="email"
            label="Envoyer un test à"
            placeholder="prenom.nom@ece.fr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-w-[12rem]"
          />
          <Button
            variant="secondary"
            icon={Send}
            loading={busy}
            disabled={!valide}
            onClick={() => onTest(email)}
          >
            Tester
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-content-faint">
          L’envoi de test utilise le contenu enregistré, pas les modifications en cours.
        </p>
      </div>
    </Card>
  );
}
