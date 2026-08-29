import { useMemo, useState } from 'react';
import { UserRound, UsersRound } from 'lucide-react';
import {
  adjustCredits,
  getManagedUser,
  listManagedUsers,
  listUserFilters,
  setUserStatus,
} from '../../../api/admin/users';
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
import { SearchInput } from '../../../components/admin/SearchInput';
import { UserDetail } from '../../../components/admin/people/UserDetail';
import { UsersTable, toUserRow } from '../../../components/admin/people/UsersTable';
import { USER_ROLE_LABEL, fullName } from '../../../utils/format';

/**
 * A-11 — Utilisateurs.
 *
 * La liste porte les métriques calculées, la fiche recharge le détail complet :
 * l'historique des réservations n'a pas à voyager pour toutes les lignes.
 */
export default function UsersPage() {
  useDocumentTitle('Utilisateurs');
  const toast = useToast();

  const [recherche, setRecherche] = useState('');
  const requete = useDebouncedValue(recherche, 250);
  const [selectionId, setSelectionId] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const referentiels = useAsync(listUserFilters, []);
  const filtres = useSelectFilters(champsDeFiltre(referentiels.data));

  const utilisateurs = useAsync(
    () => listManagedUsers({ ...filtres.valeurs, query: requete }),
    [`${filtres.cle}|${requete}`],
  );
  const fiche = useAsync(
    () => (selectionId ? getManagedUser(selectionId) : Promise.resolve(null)),
    [selectionId],
  );

  const lignes = useMemo(() => (utilisateurs.data ?? []).map(toUserRow), [utilisateurs.data]);
  const table = useDataTable(lignes, { pageSize: 15, initialSort: { key: 'name', direction: 'asc' } });

  const agir = async (action, succes) => {
    setEnvoi(true);
    try {
      await action();
      toast.success(succes);
      await Promise.all([fiche.reload(), utilisateurs.reload()]);
    } catch (erreur) {
      toast.error('Action impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Utilisateurs"
        subtitle="Fiabilité, quotas et suspension des comptes."
      />

      <FilterBar filters={filtres.filters} active={filtres.active} onReset={filtres.reset}>
        <SearchInput
          label="Rechercher un utilisateur"
          placeholder="Nom, prénom ou email"
          value={recherche}
          onChange={setRecherche}
        />
      </FilterBar>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <AsyncBoundary
          status={utilisateurs.status}
          error={utilisateurs.error}
          onRetry={utilisateurs.reload}
          isEmpty={lignes.length === 0}
          skeleton={<SkeletonCard />}
          empty={
            <Card>
              <EmptyState
                icon={UsersRound}
                title="Aucun utilisateur"
                description="Aucun compte ne correspond aux filtres appliqués."
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
            <UsersTable
              table={table}
              selectedId={selectionId}
              onSelect={(user) => setSelectionId(user.id)}
            />
          </Card>
        </AsyncBoundary>

        <DetailPanel
          title={fiche.data ? fullName(fiche.data) : undefined}
          subtitle={USER_ROLE_LABEL[fiche.data?.role] ?? fiche.data?.role}
          emptyIcon={UserRound}
          emptyDescription="Choisissez un compte pour afficher ses métriques et agir dessus."
          onClose={() => setSelectionId(null)}
        >
          {fiche.data && (
            <UserDetail
              // Remonté à chaque compte : le champ de quota ne doit pas
              // conserver la valeur saisie pour l'utilisateur précédent.
              key={fiche.data.id}
              user={fiche.data}
              busy={envoi}
              onStatus={(statut, raison) =>
                agir(
                  () => setUserStatus(selectionId, statut, { reason: raison }),
                  statut === 'suspendu' ? 'Compte suspendu' : 'Compte réactivé',
                )
              }
              onCredits={(heures) =>
                agir(() => adjustCredits(selectionId, heures), 'Quota mis à jour')
              }
            />
          )}
        </DetailPanel>
      </div>
    </div>
  );
}

/** Champs de la barre de filtres, alimentés par les référentiels de l'API. */
function champsDeFiltre(referentiels) {
  if (!referentiels) return [];
  return [
    {
      id: 'promotion',
      label: 'Promotion',
      options: referentiels.promotions.map((item) => ({ value: item, label: item })),
    },
    {
      id: 'department',
      label: 'Département',
      options: referentiels.departments.map((item) => ({ value: item, label: item })),
    },
    {
      id: 'role',
      label: 'Rôle',
      // Le magasin stocke des clés techniques : la barre de filtres affiche
      // le libellé, pas « etudiant ».
      options: referentiels.roles.map((item) => ({
        value: item,
        label: USER_ROLE_LABEL[item] ?? item,
      })),
    },
    {
      id: 'status',
      label: 'Statut',
      options: [
        { value: 'actif', label: 'Actif' },
        { value: 'suspendu', label: 'Suspendu' },
      ],
    },
  ];
}
