import { Lock } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { Tooltip } from '../../ui/Tooltip';
import { fullName } from '../../../utils/format';

/**
 * A-12 — matrice permissions × administrateurs.
 *
 * Une case cochée est une capacité réelle : décocher « Gérer les salles »
 * retire immédiatement l'entrée de menu et bloque la route pour ce compte.
 * La colonne du propriétaire est verrouillée — se retirer ses propres droits
 * fermerait la configuration pour tout le monde.
 */
export function PermissionMatrix({ groups = [], admins = [], onToggle, busy = false }) {
  return (
    // Seule table de l'administration qui reste une table sous 1024 px, et
    // c'est délibéré : la matrice existe pour comparer les comptes entre eux
    // sur une même ligne. La replier en cartes détruirait précisément la
    // lecture qu'elle sert. WCAG 1.4.10 exclut d'ailleurs les tableaux de
    // données de la règle de non-défilement bidirectionnel. Le défilement
    // reste enfermé dans ce conteneur — la page, elle, ne défile jamais
    // latéralement — et chaque colonne contient des interrupteurs focusables,
    // ce qui la rend parcourable au clavier seul.
    <div className="overflow-x-auto">
      {/* La largeur minimale ne s'applique qu'à partir de 640 px. Imposée en
          dessous, elle faisait défiler la page entière : un conteneur
          `overflow-x-auto` ne suffit pas à la contenir, comme la carte de
          densité l'avait déjà montré. Le défilement reste ici, dans le
          conteneur, et la page ne bouge plus. */}
      <table className="w-full border-collapse text-sm sm:min-w-[640px]">
        <caption className="sr-only">
          Permissions accordées à chaque compte d’administration
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-content-muted">
              Permission
            </th>
            {admins.map((admin) => (
              <th key={admin.id} scope="col" className="px-3 py-2.5 text-center">
                <span className="flex flex-col items-center gap-1">
                  <Avatar name={fullName(admin)} size="sm" />
                  <span className="text-xs font-normal text-content">{admin.firstName}</span>
                  {admin.owner && <Badge tone="accent">Propriétaire</Badge>}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {groups.map((groupe) => (
            <Groupe
              key={groupe.id}
              groupe={groupe}
              admins={admins}
              onToggle={onToggle}
              busy={busy}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Groupe({ groupe, admins, onToggle, busy }) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={admins.length + 1}
          className="bg-surface-raised px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-content-muted"
        >
          {groupe.label}
        </th>
      </tr>

      {groupe.permissions.map((permission) => (
        <tr key={permission.id} className="border-b border-line/60 last:border-0">
          <th scope="row" className="px-3 py-2.5 text-left font-normal text-content">
            {permission.label}
            {/* Le code, celui qu'on retrouve dans les journaux et dans le
                contrôle d'accès. Cette ligne affichait l'identifiant technique
                de la base — trente-six caractères qui ne disent rien. */}
            <span className="ml-2 font-mono text-[10px] text-content-faint">{permission.code}</span>
          </th>

          {admins.map((admin) => {
            // Le **code**, jamais l'identifiant technique. Une permission
            // s'identifie par son code dans tout le système : le compte en
            // rend une liste, la route d'écriture en attend une, et le
            // contrôle d'accès en prend un. L'UUID ne vit que dans la base.
            //
            // Comparé à `permission.id`, le test n'était jamais vrai : les
            // vingt-huit cases s'affichaient vides alors que la base portait
            // quinze attributions, et le clic envoyait un UUID à une route qui
            // attend un code.
            const accordee = admin.permissions.includes(permission.code);
            const verrouille = admin.owner;
            const libelle = `${permission.label} — ${fullName(admin)}`;

            if (verrouille) {
              return (
                <td key={admin.id} className="px-3 py-2.5 text-center">
                  <Tooltip label="Le compte propriétaire conserve toutes les permissions.">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-accent/40 bg-accent-soft text-accent-bright"
                      role="img"
                      aria-label={`${libelle} : accordée et verrouillée`}
                    >
                      <Lock size={13} aria-hidden="true" />
                    </span>
                  </Tooltip>
                </td>
              );
            }

            return (
              <td key={admin.id} className="px-3 py-2.5 text-center">
                <button
                  type="button"
                  role="switch"
                  aria-checked={accordee}
                  aria-label={libelle}
                  disabled={busy}
                  onClick={() => onToggle(admin, permission.code, !accordee)}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs transition',
                    accordee
                      ? 'border-success/50 bg-success-soft text-success'
                      : 'border-line bg-surface-raised text-content-faint hover:border-line-strong',
                    'disabled:opacity-50',
                  )}
                >
                  <span aria-hidden="true">{accordee ? '✓' : '—'}</span>
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
