import { useRef } from 'react';
import { Variable } from 'lucide-react';
import { Card, CardHeader } from '../../ui/Card';
import { Callout } from '../../ui/Card';
import { Input, Switch, Textarea } from '../../ui/Form';

/**
 * A-15 — édition d'un modèle d'e-mail.
 *
 * Cliquer une variable l'insère à la position du curseur plutôt qu'en fin de
 * texte : c'est la seule façon d'écrire une phrase sans la réorganiser après coup.
 */
export function TemplateEditor({ template, draft, onChange, variables = [], unknown = [], onToggle }) {
  const corpsRef = useRef(null);

  const inserer = (nom) => {
    const zone = corpsRef.current;
    const jeton = `{{${nom}}}`;
    if (!zone) {
      onChange({ body: `${draft.body}${jeton}` });
      return;
    }
    const { selectionStart: debut, selectionEnd: fin } = zone;
    const futur = `${draft.body.slice(0, debut)}${jeton}${draft.body.slice(fin)}`;
    onChange({ body: futur });
    // Le curseur est replacé après le jeton une fois React repassé.
    requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(debut + jeton.length, debut + jeton.length);
    });
  };

  return (
    <Card>
      <CardHeader
        title={template.name}
        subtitle={template.trigger}
        action={
          <Switch
            label="Modèle actif"
            checked={template.enabled}
            onChange={() => onToggle(!template.enabled)}
          />
        }
      />

      <div className="flex flex-col gap-4 p-4">
        <Input
          label="Objet"
          required
          value={draft.subject}
          onChange={(event) => onChange({ subject: event.target.value })}
        />

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide text-content-muted">
            <Variable size={12} aria-hidden="true" />
            Variables disponibles
          </p>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((nom) => (
              <button
                key={nom}
                type="button"
                onClick={() => inserer(nom)}
                className="rounded-lg border border-line bg-surface-raised px-2 py-1 font-mono text-[11px] text-content-muted transition hover:border-accent hover:text-accent"
              >
                {`{{${nom}}}`}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          ref={corpsRef}
          label="Corps du message"
          required
          rows={12}
          value={draft.body}
          onChange={(event) => onChange({ body: event.target.value })}
        />

        {unknown.length > 0 && (
          <Callout tone="danger" title="Variable inconnue">
            {`{{${unknown[0]}}}`} ne fait pas partie du référentiel : elle resterait telle quelle
            dans l’e-mail envoyé à l’utilisateur.
          </Callout>
        )}
      </div>
    </Card>
  );
}
