import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, DoorOpen, Plus, Power, Wrench } from 'lucide-react';
import { bulkUpdateRooms, listManagedRooms, listRoomFilters } from '../../../api/admin/rooms';
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
import { BulkActionBar } from '../../../components/admin/BulkActionBar';
import { FilterBar } from '../../../components/admin/FilterBar';
import { SearchInput } from '../../../components/admin/SearchInput';
import { RoomsTable, toRoomRow } from '../../../components/admin/rooms/RoomsTable';
import { plural } from '../../../utils/format';

/**
 * A-05 — Gestion des salles.
 *
 * Les actions groupées passent toutes par l'API : elle seule sait qu'une salle
 * encore réservée ne s'archive pas, et le compte rendu dit ce qui a été écarté.
 */
export default function RoomsPage() {
  useDocumentTitle('Gestion des salles');
  const toast = useToast();
  const naviguer = useNavigate();

  const [recherche, setRecherche] = useState('');
  const requete = useDebouncedValue(recherche, 250);
  const [selection, setSelection] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const referentiels = useAsync(listRoomFilters, []);
  const filtres = useSelectFilters(champsDeFiltre(referentiels.data));

  const salles = useAsync(
    () => listManagedRooms({ ...filtres.valeurs, query: requete }),
    [`${filtres.cle}|${requete}`],
  );

  const lignes = useMemo(() => (salles.data ?? []).map(toRoomRow), [salles.data]);
  const table = useDataTable(lignes, { pageSize: 15, initialSort: { key: 'name', direction: 'asc' } });

  const appliquer = async (action, participe, participePluriel) => {
    setEnvoi(true);
    try {
      const bilan = await bulkUpdateRooms(table.selection, action);
      const ecartees =
        bilan.ignorees.length > 0
          ? `${plural(bilan.ignorees.length, 'salle écartée', 'salles écartées')} : ${bilan.ignorees[0].raison}.`
          : undefined;

      // Un lot entièrement refusé n'est pas un succès : le dire autrement
      // laisserait croire que l'action a porté.
      if (bilan.traitees.length === 0) {
        toast.warning('Aucune salle traitée', ecartees);
      } else {
        toast.success(
          plural(bilan.traitees.length, `salle ${participe}`, `salles ${participePluriel}`),
          ecartees,
        );
      }
      table.viderSelection();
      await salles.reload();
    } catch (erreur) {
      toast.error('Action impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Gestion des salles"
        subtitle="Catalogue, disponibilité et actions groupées sur le parc."
        actions={
          <Button icon={Plus} to="/admin/salles/nouvelle">
            Nouvelle salle
          </Button>
        }
      />

      <FilterBar filters={filtres.filters} active={filtres.active} onReset={filtres.reset}>
        <SearchInput
          label="Rechercher une salle"
          placeholder="Nom de la salle"
          value={recherche}
          onChange={setRecherche}
        />
      </FilterBar>

      <AsyncBoundary
        status={salles.status}
        error={salles.error}
        onRetry={salles.reload}
        isEmpty={lignes.length === 0}
        skeleton={<SkeletonCard />}
        empty={
          <Card>
            <EmptyState
              icon={DoorOpen}
              title="Aucune salle"
              description="Aucune salle ne correspond aux filtres appliqués."
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
          <RoomsTable
            table={table}
            selectedId={selection?.id}
            onSelect={(room) => {
              setSelection(room);
              naviguer(`/admin/salles/${room.id}`);
            }}
          />
        </Card>
      </AsyncBoundary>

      <BulkActionBar
        count={table.selection.length}
        label="salle sélectionnée"
        labelPlural="salles sélectionnées"
        onClear={table.viderSelection}
        actions={[
          {
            id: 'activer',
            label: 'Remettre en service',
            icon: Power,
            onClick: () => appliquer('activer', 'remise en service', 'remises en service'),
          },
          {
            id: 'maintenance',
            label: 'Mettre en maintenance',
            icon: Wrench,
            onClick: () => appliquer('maintenance', 'mise en maintenance', 'mises en maintenance'),
          },
          {
            id: 'archiver',
            label: 'Archiver',
            icon: Archive,
            tone: 'danger',
            onClick: () => appliquer('archiver', 'archivée', 'archivées'),
          },
        ]}
        busy={envoi}
      />
    </div>
  );
}

/** Champs de la barre de filtres, alimentés par les référentiels de l'API. */
function champsDeFiltre(referentiels) {
  if (!referentiels) return [];
  return [
    { id: 'buildingId', label: 'Bâtiment', options: referentiels.buildings },
    { id: 'floor', label: 'Étage', options: referentiels.floors },
    { id: 'status', label: 'Statut', options: referentiels.statuses },
    { id: 'minCapacity', label: 'Capacité', options: referentiels.capacities },
  ];
}
