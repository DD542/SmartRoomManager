import { Laptop, LogOut, MapPin, Smartphone } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { fmtDateLong } from '../../../utils/dates';

/**
 * Sessions ouvertes du compte.
 *
 * Une ligne par session, c'est-à-dire par famille de jetons : chaque
 * rafraîchissement en émet un nouveau et consomme le précédent, si bien qu'un
 * seul navigateur en produit des dizaines par jour. Les afficher un par un
 * annoncerait « 47 appareils connectés » à qui n'en a qu'un, et rendrait la
 * liste inutilisable pour ce à quoi elle sert : repérer un accès qu'on ne
 * reconnaît pas.
 */
export function SessionList({ sessions = [], onRevokeOthers, busy = false }) {
  const autres = sessions.filter((item) => !item.current).length;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <ul className="flex flex-col gap-2">
        {sessions.map((item) => {
          const Icone = mobile(item.userAgent) ? Smartphone : Laptop;
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-raised p-3"
            >
              <Icone size={16} aria-hidden="true" className="text-content-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">
                  {appareil(item.userAgent)}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-content-muted">
                  {item.ip && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={11} aria-hidden="true" />
                      {item.ip}
                    </span>
                  )}
                  {item.startedAt && <span>Ouverte le {fmtDateLong(item.startedAt)}</span>}
                  <span>{item.scope === 'admin' ? 'Espace admin' : 'Espace utilisateur'}</span>
                </span>
              </span>
              {item.current && (
                <Badge tone="success" dot>
                  Cet appareil
                </Badge>
              )}
            </li>
          );
        })}
      </ul>

      {autres > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          icon={LogOut}
          loading={busy}
          className="w-fit"
          onClick={onRevokeOthers}
        >
          Fermer les {autres} autre{autres > 1 ? 's' : ''} session{autres > 1 ? 's' : ''}
        </Button>
      ) : (
        <p className="text-xs text-content-faint">
          Aucune autre session ouverte : ce compte n’est connecté que sur cet appareil.
        </p>
      )}
    </div>
  );
}

/**
 * Appareil décrit par son agent utilisateur.
 *
 * Une lecture volontairement grossière : la chaîne est déclarative et
 * falsifiable, et prétendre en tirer « iPhone 14 Pro, iOS 17.2 » donnerait à
 * une donnée peu fiable une précision qu'elle n'a pas. Le navigateur et le
 * système suffisent à reconnaître — ou non — un accès.
 */
function appareil(agent) {
  if (!agent) return 'Appareil inconnu';

  const navigateur =
    [
      ['Edg/', 'Edge'],
      ['OPR/', 'Opera'],
      ['Chrome/', 'Chrome'],
      ['Firefox/', 'Firefox'],
      ['Safari/', 'Safari'],
    ].find(([motif]) => agent.includes(motif))?.[1] ?? 'Navigateur';

  const systeme =
    [
      ['Windows', 'Windows'],
      ['Android', 'Android'],
      ['iPhone', 'iPhone'],
      ['iPad', 'iPad'],
      ['Mac OS X', 'macOS'],
      ['Linux', 'Linux'],
    ].find(([motif]) => agent.includes(motif))?.[1] ?? 'système inconnu';

  return `${navigateur} sur ${systeme}`;
}

const mobile = (agent) => /Android|iPhone|iPad|Mobile/i.test(agent ?? '');
