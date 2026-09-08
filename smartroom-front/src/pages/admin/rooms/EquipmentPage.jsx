import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import {
  deleteEquipment,
  equipmentCategories,
  listEquipmentCatalog,
  listIcons,
  saveEquipment,
  toggleFilterable,
} from '../../../api/admin/equipment';
import { useAsync } from '../../../hooks/useAsync';
import { useDataTable } from '../../../hooks/useDataTable';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Badge } from '../../../components/ui/Badge';
import { Button, IconButton } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Switch } from '../../../components/ui/Form';
import { Modal } from '../../../components/ui/Modal';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { DataTable } from '../../../components/admin/DataTable';
import { EquipmentModal } from '../../../components/admin/rooms/EquipmentModal';
import { equipmentIcon } from '../../../components/rooms/equipmentIcons';
import { plural } from '../../../utils/format';

/**
 * A-07 — Catalogue des équipements.
 *
 * Le nombre de salles équipées est calculé depuis le catalogue des salles :
 * il dit immédiatement si un équipement est réellement utilisé.
 */
export default function EquipmentPage() {
  useDocumentTitle('Catalogue des équipements');
  const toast = useToast();

  const [edition, setEdition] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [suppression, setSuppression] = useState(null);
  const [retrait, setRetrait] = useState(false);

  const catalogue = useAsync(listEquipmentCatalog, []);
  const icones = useAsync(listIcons, []);
  const categories = useMemo(equipmentCategories, []);

  const lignes = useMemo(
    () =>
      (catalogue.data ?? []).map((item) => ({
        ...item,
        categoryLabel: categories.find((c) => c.id === item.category)?.label ?? item.category,
      })),
    [catalogue.data, categories],
  );
  const table = useDataTable(lignes, { pageSize: 15, initialSort: { key: 'label', direction: 'asc' } });

  const basculerFiltre = async (item) => {
    try {
      await toggleFilterable(item.id, !item.filterable);
      await catalogue.reload();
    } catch (erreur) {
      toast.error('Modification impossible', erreur.message);
    }
  };

  const enregistrer = async (form) => {
    setEnvoi(true);
    try {
      const item = await saveEquipment(form);
      toast.success(form.id ? 'Équipement modifié' : 'Équipement créé', item.label);
      setEdition(null);
      await catalogue.reload();
    } catch (erreur) {
      toast.error('Enregistrement impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  /**
   * Retrait d'un équipement.
   *
   * L'API refuse tant qu'une salle le déclare : la retirer sous les pieds des
   * fiches de salle les ferait mentir. Le bouton reste donc visible sur les
   * lignes utilisées — il porte l'explication — mais il est désactivé : un
   * bouton absent laisserait croire que la suppression n'existe pas, un bouton
   * actif qui échoue à chaque clic ferait croire à une panne.
   */
  const supprimer = async () => {
    setRetrait(true);
    try {
      await deleteEquipment(suppression.id);
      toast.success('Équipement supprimé', suppression.label);
      setSuppression(null);
      await catalogue.reload();
    } catch (erreur) {
      toast.error('Suppression impossible', erreur.message);
    } finally {
      setRetrait(false);
    }
  };

  const boutonSupprimer = (row) => (
    <IconButton
      icon={Trash2}
      variant="danger"
      disabled={row.roomCount > 0}
      label={
        row.roomCount > 0
          ? `${row.label} équipe ${plural(row.roomCount, 'salle')} : retirez-le d’abord de ces salles`
          : `Supprimer ${row.label}`
      }
      onClick={() => setSuppression(row)}
    />
  );

  const colonnes = [
    {
      key: 'label',
      label: 'Équipement',
      render: (row) => {
        const Icone = equipmentIcon(row.icon);
        return (
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-raised">
              <Icone size={15} aria-hidden="true" className="text-content-muted" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-content">{row.label}</span>
              {row.description && (
                <span className="block truncate text-[11px] text-content-faint">
                  {row.description}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    { key: 'categoryLabel', label: 'Catégorie' },
    {
      key: 'roomCount',
      label: 'Salles équipées',
      align: 'right',
      render: (row) =>
        row.roomCount === 0 ? (
          <Badge tone="muted">Inutilisé</Badge>
        ) : (
          <span className="font-mono text-content">{row.roomCount}</span>
        ),
    },
    {
      key: 'filterable',
      label: 'Filtre de recherche',
      sortable: false,
      render: (row) => (
        <Switch
          label={`Proposer « ${row.label} » comme filtre`}
          checked={row.filterable}
          onChange={() => basculerFiltre(row)}
        />
      ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          <IconButton
            icon={Pencil}
            label={`Modifier ${row.label}`}
            onClick={() => setEdition(row)}
          />
          {boutonSupprimer(row)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Catalogue des équipements"
        subtitle={`${plural(lignes.length, 'équipement')} — utilisés par les fiches de salle et les filtres.`}
        actions={
          <Button icon={Plus} onClick={() => setEdition({})}>
            Nouvel équipement
          </Button>
        }
      />

      <AsyncBoundary
        status={catalogue.status}
        error={catalogue.error}
        onRetry={catalogue.reload}
        isEmpty={lignes.length === 0}
        skeleton={<SkeletonCard />}
        empty={
          <Card>
            <EmptyState
              icon={Wrench}
              title="Catalogue vide"
              description="Créez un premier équipement pour pouvoir l’associer aux salles."
            />
          </Card>
        }
      >
        <Card className="overflow-hidden">
          <DataTable
            columns={colonnes}
            table={table}
            rowLabel="équipements"
            /* Sous 1024 px : cinq colonnes, dont une portant une description,
               demandaient 627 px dans un conteneur de 321. La carte reprend
               les mêmes données et les mêmes actions, empilées. */
            carte={(row) => {
              const Icone = equipmentIcon(row.icon);
              return (
                <div className="rounded-xl border border-line bg-surface-raised p-3">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
                      <Icone size={15} aria-hidden="true" className="text-content-muted" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-content">{row.label}</p>
                      {row.description && (
                        <p className="truncate text-[11px] text-content-faint">{row.description}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-content-muted">
                        {row.categoryLabel} · {plural(row.roomCount, 'salle équipée', 'salles équipées')}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1">
                      <IconButton
                        icon={Pencil}
                        label={`Modifier ${row.label}`}
                        onClick={() => setEdition(row)}
                      />
                      {boutonSupprimer(row)}
                    </span>
                  </div>
                  <div className="mt-2.5 border-t border-line pt-2.5">
                    <Switch
                      label={`Proposer « ${row.label} » comme filtre`}
                      checked={row.filterable}
                      onChange={() => basculerFiltre(row)}
                    />
                  </div>
                </div>
              );
            }}
          />
        </Card>
      </AsyncBoundary>

      <EquipmentModal
        open={Boolean(edition)}
        onClose={() => setEdition(null)}
        onSubmit={enregistrer}
        equipment={edition?.id ? edition : null}
        icons={icones.data ?? []}
        categories={categories}
        loading={envoi}
      />

      <Modal
        open={Boolean(suppression)}
        onClose={() => setSuppression(null)}
        icon={Trash2}
        tone="danger"
        title="Supprimer cet équipement"
        description="Le retrait est définitif : l’équipement disparaît du catalogue et des filtres de recherche."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuppression(null)}>
              Revenir
            </Button>
            <Button variant="danger-solid" loading={retrait} onClick={supprimer}>
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-content-muted">
          <span className="text-content">« {suppression?.label} »</span> n’équipe aucune salle : sa
          suppression ne modifie aucune fiche. Les réservations passées ne s’en trouvent pas
          changées, l’équipement n’y étant pas recopié.
        </p>
      </Modal>
    </div>
  );
}
