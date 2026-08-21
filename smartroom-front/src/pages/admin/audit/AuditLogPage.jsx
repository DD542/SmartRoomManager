import { useState } from 'react';
import { Download, ScrollText, ShieldQuestion } from 'lucide-react';
import {
  exportAuditLog,
  flagAuditEntry,
  getAuditEntry,
  listAuditActions,
  listAuditAuthors,
  listAuditEntries,
} from '../../../api/admin/audit';
import { useAsync } from '../../../hooks/useAsync';
import { useDataTable } from '../../../hooks/useDataTable';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useSelectFilters } from '../../../hooks/useSelectFilters';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { DetailPanel } from '../../../components/admin/DetailPanel';
import { FilterBar } from '../../../components/admin/FilterBar';
import { PermissionGate } from '../../../components/admin/PermissionGate';
import { SearchInput } from '../../../components/admin/SearchInput';
import { AuditDetail } from '../../../components/admin/audit/AuditDetail';
import { AuditTable } from '../../../components/admin/audit/AuditTable';
import { plural } from '../../../utils/format';

const PERIODES = [
  { value: '24h', label: 'Dernières 24 h' },
  { value: '7j', label: '7 derniers jours' },
  { value: '30j', label: '30 derniers jours' },
  { value: 'tout', label: 'Tout l’historique' },
];

/**
 * A-16 — Journal d'audit.
 *
 * Consultable par tout administrateur, exportable seulement avec la permission
 * d'export : lire la trace et l'emporter hors de l'application sont deux
 * responsabilités distinctes.
 */
export default function AuditLogPage() {
  useDocumentTitle('Journal d’audit');
  const toast = useToast();

  const [recherche, setRecherche] = useState('');
  const requete = useDebouncedValue(recherche, 250);
  const [selectionId, setSelectionId] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const auteurs = useAsync(listAuditAuthors, []);
  const actions = useAsync(listAuditActions, []);

  const filtres = useSelectFilters([
    { id: 'period', label: 'Période', options: PERIODES },
    {
      id: 'authorId',
      label: 'Auteur',
      options: (auteurs.data ?? [])
        .filter((auteur) => auteur.id)
        .map((auteur) => ({ value: auteur.id, label: auteur.label })),
    },
    {
      id: 'action',
      label: 'Action',
      options: (actions.data ?? []).map((action) => ({ value: action.id, label: action.label })),
    },
  ]);

  const entrees = useAsync(
    () =>
      listAuditEntries({
        ...filtres.valeurs,
        period: filtres.valeurs.period ?? '7j',
        query: requete,
      }),
    [`${filtres.cle}|${requete}`],
  );

  const detail = useAsync(
    () => (selectionId ? getAuditEntry(selectionId) : Promise.resolve(null)),
    [selectionId],
  );

  const table = useDataTable(entrees.data ?? [], {
    pageSize: 20,
    initialSort: { key: 'at', direction: 'desc' },
  });

  const signaler = async () => {
    setEnvoi(true);
    try {
      await flagAuditEntry(selectionId, 'Signalée depuis le journal d’audit');
      toast.success('Action signalée', 'Le journal reste inchangé : la marque s’y ajoute.');
      await Promise.all([detail.reload(), entrees.reload()]);
    } catch (erreur) {
      toast.error('Signalement impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const exporter = async () => {
    setEnvoi(true);
    try {
      const fichier = await exportAuditLog({
        ...filtres.valeurs,
        period: filtres.valeurs.period ?? '7j',
        query: requete,
      });
      toast.success('Journal exporté', `${fichier.filename} — ${plural(fichier.rows, 'ligne')}.`);
    } catch (erreur) {
      toast.error('Export impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journal d’audit"
        subtitle="Trace immuable des actions d’administration."
        actions={
          <PermissionGate permission="data.export" mode="desactiver">
            <Button icon={Download} loading={envoi} onClick={exporter}>
              Exporter le journal
            </Button>
          </PermissionGate>
        }
      />

      <FilterBar filters={filtres.filters} active={filtres.active} onReset={filtres.reset}>
        <SearchInput
          label="Rechercher dans le journal"
          placeholder="Cible ou auteur"
          value={recherche}
          onChange={setRecherche}
        />
      </FilterBar>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <AsyncBoundary
          status={entrees.status}
          error={entrees.error}
          onRetry={entrees.reload}
          isEmpty={(entrees.data ?? []).length === 0}
          skeleton={<SkeletonCard />}
          empty={
            <Card>
              <EmptyState
                icon={ScrollText}
                title="Aucune action enregistrée"
                description="Aucune action ne correspond aux filtres appliqués."
                action={
                  <Button variant="secondary" size="sm" onClick={filtres.reset}>
                    Réinitialiser les filtres
                  </Button>
                }
              />
            </Card>
          }
        >
          <Card className="overflow-hidden">
            <AuditTable table={table} onSelect={(entry) => setSelectionId(entry.id)} />
          </Card>
        </AsyncBoundary>

        <DetailPanel
          title={detail.data?.target}
          subtitle={detail.data ? `Action #${detail.data.id}` : undefined}
          emptyIcon={ShieldQuestion}
          emptyDescription="Choisissez une ligne pour voir ce qui a changé et depuis où."
          onClose={() => setSelectionId(null)}
        >
          {detail.data && (
            <AuditDetail entry={detail.data} onFlag={signaler} busy={envoi} />
          )}
        </DetailPanel>
      </div>
    </div>
  );
}
