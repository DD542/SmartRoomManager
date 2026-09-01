import { Flag, Globe, Laptop, MapPin } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { DetailRow } from '../DetailPanel';
import { actionLabels } from '../../../api/admin/audit';
import { fmtDateLong, fmtTime } from '../../../utils/dates';

/**
 * A-16 — détail d'une action : ce qui a changé, et depuis où.
 *
 * Le diff compare les deux états champ par champ, y compris les champs
 * apparus ou disparus : n'afficher que l'état final masquerait justement ce
 * que l'audit sert à retrouver.
 */
export function AuditDetail({ entry, onFlag, busy = false }) {
  // `entry.before` et `entry.after`, tels que l'adaptateur les produit.
  //
  // Ce composant lisait `entry.diff?.before` : un niveau qui n'existe pas.
  // L'optionnel absorbait l'absence, le repli donnait un objet vide, et la
  // section « ce qui a changé » se rendait sans une ligne — sans erreur, sur
  // les 91 entrées d'un journal qui portait pourtant toutes ses valeurs.
  // C'était la raison d'être de l'écran qui manquait.
  const avantTout = entry.before ?? {};
  const apresTout = entry.after ?? {};
  const champs = [...new Set([...Object.keys(avantTout), ...Object.keys(apresTout)])];

  return (
    <>
      <DetailRow label="Horodatage">
        <span className="capitalize">{fmtDateLong(entry.at)}</span>
        <br />
        <span className="font-mono text-xs text-content-muted">{fmtTime(entry.at)}</span>
      </DetailRow>
      <DetailRow label="Auteur">{entry.authorName ?? 'Système'}</DetailRow>
      <DetailRow label="Action">
        <Badge tone="accent">{actionLabels[entry.action] ?? entry.action}</Badge>
      </DetailRow>
      <DetailRow label="Cible">{entry.target}</DetailRow>
      <DetailRow label="Identifiant" mono>
        {entry.targetId ?? '—'}
      </DetailRow>

      {champs.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
            Avant / après
          </p>
          <ul className="flex flex-col gap-1.5">
            {champs.map((champ) => {
              const avant = avantTout[champ];
              const apres = apresTout[champ];
              return (
                <li
                  key={champ}
                  className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-xs"
                >
                  <span className="block text-content-muted">{champ}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="rounded bg-danger-soft px-1.5 py-0.5 text-danger line-through">
                      {avant ?? 'absent'}
                    </span>
                    <span aria-hidden="true" className="text-content-faint">
                      →
                    </span>
                    <span className="rounded bg-success-soft px-1.5 py-0.5 text-success">
                      {apres ?? 'retiré'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-content-muted">
          Métadonnées techniques
        </p>
        <dl className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-raised p-3 text-xs">
          <Meta icon={Globe} label="Adresse IP">
            {entry.ip}
          </Meta>
          <Meta icon={Laptop} label="Navigateur">
            {entry.metadata?.browser} · {entry.metadata?.os}
          </Meta>
          <Meta icon={MapPin} label="Localisation">
            {entry.metadata?.location}
          </Meta>
          <Meta label="Session">{entry.metadata?.sessionId}</Meta>
        </dl>
      </div>

      {entry.flagged ? (
        <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-xs text-content">
          <Flag size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          Action signalée{entry.flagReason ? ` : ${entry.flagReason}` : '.'}
        </p>
      ) : (
        <Button variant="danger" size="sm" icon={Flag} loading={busy} onClick={onFlag}>
          Signaler cette action
        </Button>
      )}
    </>
  );
}

function Meta({ icon: Icone, label, children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-content-muted">
        {Icone && <Icone size={12} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="text-right font-mono text-[11px] text-content">{children}</dd>
    </div>
  );
}
