import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  Gauge,
  ShieldAlert,
  Timer,
  Wrench,
} from 'lucide-react';
import { getAssistantEtat, getAssistantStatistiques } from '../../../api/admin/assistant';
import { useAsync } from '../../../hooks/useAsync';
import { Badge, Pill } from '../../ui/Badge';
import { Card, CardHeader } from '../../ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../ui/States';
import { KpiTile } from '../../stats/KpiTile';

/**
 * A-13 — Observabilité de l'assistant.
 *
 * Quatre chiffres portent la décision, et le second est le plus important pour
 * une démonstration : le **taux de repli** dit quelle part des réponses est
 * venue du moteur déterministe plutôt que du modèle. Un taux élevé n'est pas
 * une panne — l'utilisateur a été servi — mais il annonce ce que verra le jury.
 *
 * Le taux de résolution est celui des tours sans transfert humain. C'est la
 * seule mesure honnête disponible : on ne sait pas si l'utilisateur est reparti
 * satisfait, on sait s'il a dû demander quelqu'un.
 */

const FENETRES = [
  { value: 7, label: '7 jours' },
  { value: 30, label: '30 jours' },
  { value: 90, label: '90 jours' },
];

const pourcent = (valeur) => `${Math.round((valeur ?? 0) * 100)} %`;
const millisecondes = (valeur) => (valeur == null ? '—' : `${valeur} ms`);

function EtatFournisseurs({ etat }) {
  const ollama = etat?.fournisseurs?.ollama ?? {};
  const distant = etat?.fournisseurs?.distant ?? {};
  const index = etat?.index_documentaire ?? {};
  const manquants = ollama.manquants ?? [];

  return (
    <Card>
      <CardHeader title="État de la couche" icon={Cpu} />
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3 [&>*]:min-w-0">
        <div className="rounded-xl border border-line bg-surface-raised p-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <Badge tone={ollama.joignable ? 'success' : 'neutral'}>
              {ollama.joignable ? 'joignable' : 'absent'}
            </Badge>
            Ollama
          </p>
          <p className="mt-1.5 text-xs text-content-muted">
            {(ollama.modeles_installes ?? []).length} modèle(s) installé(s)
          </p>
          {manquants.length > 0 && (
            <p className="mt-1 text-xs text-warning">
              Configuré mais absent : {manquants.join(', ')}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface-raised p-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <Badge tone={distant.utilisable ? 'success' : 'neutral'}>
              {distant.configure ? (distant.utilisable ? 'prêt' : 'incomplet') : 'désactivé'}
            </Badge>
            Fournisseur distant
          </p>
          <p className="mt-1.5 text-xs text-content-muted">
            Anonymisation {distant.anonymisation ? 'branchée' : 'absente'}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface-raised p-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <Database size={15} className="text-accent" aria-hidden="true" />
            Index documentaire
          </p>
          <p className="mt-1.5 text-xs text-content-muted">
            {index.vectorises ?? 0} / {index.fragments ?? 0} fragments vectorisés
            {index.modele ? ` — ${index.modele}` : ''}
          </p>
          {index.fragments > 0 && index.vectorises < index.fragments && (
            // Écart normal après une écriture sans modèle joignable : la
            // recherche lexicale les trouve déjà, la réindexation fera le reste.
            <p className="mt-1 text-xs text-warning">
              Réindexation nécessaire pour la recherche sémantique.
            </p>
          )}
        </div>
      </div>

      {etat?.fournisseurs?.repli_force && (
        <p className="mx-4 mb-4 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-content">
          Repli forcé par configuration : aucune inférence n’est demandée, toutes les réponses
          viennent du moteur déterministe.
        </p>
      )}
    </Card>
  );
}

export function AssistantDashboard() {
  const [jours, setJours] = useState(7);
  const statistiques = useAsync(() => getAssistantStatistiques(jours), [jours]);
  const etat = useAsync(getAssistantEtat, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content">Assistant conversationnel</h2>
        <div className="flex gap-1.5">
          {FENETRES.map((fenetre) => (
            <Pill
              key={fenetre.value}
              active={jours === fenetre.value}
              onClick={() => setJours(fenetre.value)}
            >
              {fenetre.label}
            </Pill>
          ))}
        </div>
      </div>

      <AsyncBoundary
        status={etat.status}
        error={etat.error}
        onRetry={etat.reload}
        skeleton={<SkeletonCard />}
      >
        {etat.data && <EtatFournisseurs etat={etat.data} />}
      </AsyncBoundary>

      <AsyncBoundary
        status={statistiques.status}
        error={statistiques.error}
        onRetry={statistiques.reload}
        skeleton={<SkeletonCard />}
      >
        {statistiques.data && statistiques.data.tours === 0 ? (
          <EmptyState
            icon={Activity}
            title="Aucune conversation sur la période"
            description="Les chiffres apparaîtront dès les premiers échanges avec l’assistant."
          />
        ) : (
          statistiques.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
                <KpiTile
                  icon={Gauge}
                  tone="accent"
                  value={pourcent(statistiques.data.taux_resolution)}
                  label="Tours résolus sans transfert humain"
                />
                <KpiTile
                  icon={Activity}
                  value={pourcent(statistiques.data.taux_repli)}
                  label="Réponses rendues par le moteur déterministe"
                />
                <KpiTile
                  icon={Timer}
                  value={millisecondes(statistiques.data.latence_mediane_ms)}
                  label={`Durée médiane d’un tour — premier jeton ${millisecondes(
                    statistiques.data.premier_jeton_median_ms,
                  )}`}
                />
                <KpiTile
                  icon={ShieldAlert}
                  value={String(statistiques.data.injections)}
                  label="Messages portant une tentative d’écrasement de consigne"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader
                    title="Outils les plus appelés"
                    subtitle={`${statistiques.data.tours} tour(s) sur la période`}
                    icon={Wrench}
                  />
                  <ul className="space-y-1.5 px-4 pb-4">
                    {statistiques.data.outils.map((ligne) => (
                      <li
                        key={ligne.outil}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate font-mono text-xs text-content-muted">
                          {ligne.outil}
                        </span>
                        <span className="text-content">{ligne.appels}</span>
                      </li>
                    ))}
                    {statistiques.data.outils.length === 0 && (
                      <li className="text-xs text-content-muted">Aucun appel d’outil.</li>
                    )}
                  </ul>
                </Card>

                <Card>
                  <CardHeader
                    title="Causes de bascule vers le déterministe"
                    subtitle="Ce qui a empêché le modèle de répondre"
                    icon={AlertTriangle}
                  />
                  <ul className="space-y-1.5 px-4 pb-4">
                    {statistiques.data.replis.map((ligne) => (
                      <li
                        key={ligne.cause}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate font-mono text-xs text-content-muted">
                          {ligne.cause}
                        </span>
                        <span className="text-content">{ligne.tours}</span>
                      </li>
                    ))}
                    {statistiques.data.replis.length === 0 && (
                      <li className="text-xs text-content-muted">
                        Aucune bascule : toutes les réponses viennent du modèle.
                      </li>
                    )}
                  </ul>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Conversations à revoir"
                  subtitle="Transférées à un humain, ou dont une affirmation n’était pas étayée"
                  icon={AlertTriangle}
                />
                <ul className="divide-y divide-line px-4 pb-4">
                  {(statistiques.data.a_revoir ?? []).map((ligne) => (
                    <li key={ligne.tour_id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {ligne.titre}
                      </span>
                      {ligne.transfert && <Badge tone="warning">transfert humain</Badge>}
                      {!ligne.etaye && <Badge tone="danger">non étayé</Badge>}
                      <span className="text-xs text-content-muted">
                        {new Date(ligne.quand).toLocaleString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </li>
                  ))}
                  {(statistiques.data.a_revoir ?? []).length === 0 && (
                    <li className="py-2 text-xs text-content-muted">
                      Rien à revoir sur la période.
                    </li>
                  )}
                </ul>
              </Card>
            </>
          )
        )}
      </AsyncBoundary>
    </div>
  );
}
