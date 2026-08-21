import { useState } from 'react';
import { Accessibility, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../ui/Button';
import { Input, Switch } from '../../ui/Form';
import { Callout } from '../../ui/Card';

/**
 * A-06 — onglet Accès.
 *
 * Les consignes saisies ici sont celles qui s'affichent à l'utilisateur avant
 * confirmation puis dans l'e-mail : elles doivent rester courtes et vérifiables.
 */
export function AccessTab({ draft, onChange }) {
  const [saisie, setSaisie] = useState('');
  const consignes = draft.rules?.constraints ?? [];

  const modifierRegles = (patch) => onChange({ rules: { ...draft.rules, ...patch } });

  const ajouter = () => {
    const texte = saisie.trim();
    if (!texte) return;
    modifierRegles({ constraints: [...consignes, texte] });
    setSaisie('');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Switch
          label="Badge obligatoire"
          description="Un code d’accès est généré à chaque réservation confirmée."
          icon={KeyRound}
          checked={draft.badgeRequired}
          onChange={() => onChange({ badgeRequired: !draft.badgeRequired })}
        />
        <Switch
          label="Accessible aux personnes à mobilité réduite"
          description="Affiché en pictogramme sur la fiche et filtrable à la recherche."
          icon={Accessibility}
          checked={draft.accessible}
          onChange={() => onChange({ accessible: !draft.accessible })}
        />
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
          Consignes d’utilisation
        </p>

        {consignes.length === 0 ? (
          <Callout tone="info">Aucune consigne particulière pour cette salle.</Callout>
        ) : (
          <ul className="flex flex-col gap-2">
            {consignes.map((consigne, index) => (
              <li
                key={consigne}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-sm text-content">{consigne}</span>
                <IconButton
                  icon={Trash2}
                  label={`Retirer la consigne « ${consigne} »`}
                  onClick={() =>
                    modifierRegles({
                      constraints: consignes.filter((_, position) => position !== index),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input
            label="Ajouter une consigne"
            placeholder="Nourriture interdite, seules les boissons fermées sont autorisées."
            value={saisie}
            onChange={(event) => setSaisie(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Sans cela, la touche Entrée soumettrait le formulaire parent
              // au lieu d'ajouter la ligne en cours de saisie.
              event.preventDefault();
              ajouter();
            }}
            className="min-w-[16rem]"
          />
          <Button variant="secondary" icon={Plus} disabled={!saisie.trim()} onClick={ajouter}>
            Ajouter
          </Button>
        </div>
      </div>
    </div>
  );
}
