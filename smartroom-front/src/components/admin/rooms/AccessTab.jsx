import { Accessibility, KeyRound } from 'lucide-react';
import { Switch, Textarea } from '../../ui/Form';
import { Callout } from '../../ui/Card';

/**
 * A-06 — onglet Accès.
 *
 * La consigne saisie ici s'affiche à l'utilisateur au moment de choisir son
 * créneau, et dans la fiche de la salle.
 *
 * Elle était jusqu'ici une liste de lignes ajoutées une à une dans
 * `rules.constraints`. Deux choses clochaient. `constraints` n'est pas une
 * donnée : c'est la traduction en phrases des dix seuils numériques, calculée
 * à la lecture — « Durée comprise entre 30 et 240 minutes ». Et rien ne
 * l'envoyait au serveur : `saveRoomAvailability` ne connaissait que trois
 * champs. Les consignes saisies disparaissaient donc à l'enregistrement, sans
 * message, et l'écran les réaffichait aussitôt recalculées à partir des
 * seuils — ce qui donnait l'illusion qu'elles avaient été gardées.
 *
 * Une seule consigne, un seul champ, réellement écrit : `notice`, porté par la
 * règle de la salle.
 */
export function AccessTab({ draft, onChange }) {
  const regles = draft.rules ?? {};
  const modifierRegles = (patch) => onChange({ rules: { ...regles, ...patch } });

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
        <Textarea
          label="Consigne d’utilisation"
          hint="Facultative, 500 caractères au plus. Affichée à l’utilisateur avant qu’il confirme, et sur la fiche de la salle. Elle ne vaut que pour cette salle."
          rows={3}
          maxLength={500}
          placeholder="Nourriture interdite, seules les boissons fermées sont autorisées."
          value={regles.notice ?? ''}
          onChange={(event) => modifierRegles({ notice: event.target.value })}
        />
      </div>

      {/* En lecture seule, et signalé comme tel : ces phrases sont la
          traduction des seuils réglés dans « Règles de réservation ». Les
          rendre modifiables ici laisserait croire qu'un texte peut contredire
          le moteur qui, lui, applique les nombres. */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
          Règles appliquées à cette salle
        </p>
        {(regles.constraints ?? []).length === 0 ? (
          <Callout tone="info">
            Aucune règle particulière : la salle suit les règles globales.
          </Callout>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(regles.constraints ?? []).map((ligne) => (
              <li
                key={ligne}
                className="rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm text-content-muted"
              >
                {ligne}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-content-faint">
          Ces phrases décrivent les seuils réglés dans « Règles de réservation ». Elles se
          modifient là-bas, jamais ici : c’est le nombre qui est appliqué, pas la phrase.
        </p>
      </div>
    </div>
  );
}
