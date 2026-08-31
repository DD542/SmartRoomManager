import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarPlus, CalendarX2, Rows3 } from 'lucide-react';
import {
  listAllBookings,
  listBookableUsers,
  listBookingFilters,
} from '../../../api/admin/bookings';
import { useAsync } from '../../../hooks/useAsync';
import { useBookingActions } from '../../../hooks/useBookingActions';
import { useDataTable } from '../../../hooks/useDataTable';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useSelectFilters } from '../../../hooks/useSelectFilters';
import { plural } from '../../../utils/format';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Callout } from '../../../components/ui/Card';
import { SegmentedControl } from '../../../components/ui/Tabs';
import { BulkActionBar } from '../../../components/admin/BulkActionBar';
import { FilterBar } from '../../../components/admin/FilterBar';
import { PermissionGate } from '../../../components/admin/PermissionGate';
import { SearchInput } from '../../../components/admin/SearchInput';
import { AdminBookingModal } from '../../../components/admin/bookings/AdminBookingModal';
import { toRow } from '../../../components/admin/bookings/BookingsTable';
import { BookingsWorkspace } from '../../../components/admin/bookings/BookingsWorkspace';
import { CancelBookingModal } from '../../../components/admin/bookings/CancelBookingModal';

const AFFICHAGES = [
  { value: 'table', label: 'Table', icon: Rows3 },
  { value: 'calendrier', label: 'Calendrier', icon: CalendarDays },
];

/**
 * A-03 — Toutes les réservations.
 *
 * La consultation est ouverte à tout administrateur ; créer, bloquer ou annuler
 * demande la permission d'arbitrage, comme la file des conflits.
 */
export default function AllBookingsPage() {
  useDocumentTitle('Toutes les réservations');

  const [affichage, setAffichage] = useState('table');

  // La recherche de la barre haute mène ici — `/admin/reservations?q=…` — et
  // ce paramètre n'était pas lu. Taper « salle curie » en haut de l'écran
  // amenait donc sur la liste entière, champ de recherche vide, première page :
  // rien ne distinguait une recherche sans résultat d'une recherche jamais
  // faite. L'espace utilisateur, lui, lisait déjà son `q`.
  const [params, setParams] = useSearchParams();
  const [recherche, setRecherche] = useState(() => params.get('q') ?? '');
  const requete = useDebouncedValue(recherche, 250);

  // L'adresse suit la saisie : une recherche se partage, se met en favori et
  // survit à un rechargement.
  useEffect(() => {
    const actuel = params.get('q') ?? '';
    if (actuel === requete) return;
    const suivant = new URLSearchParams(params);
    if (requete) suivant.set('q', requete);
    else suivant.delete('q');
    setParams(suivant, { replace: true });
  }, [requete, params, setParams]);

  const referentiels = useAsync(listBookingFilters, []);
  const filtres = useSelectFilters(champsDeFiltre(referentiels.data));

  const [selection, setSelection] = useState(null);
  const [creation, setCreation] = useState(false);
  const [annulation, setAnnulation] = useState(null);

  const reservations = useAsync(
    () => listAllBookings({ ...filtres.valeurs, query: requete }),
    [`${filtres.cle}|${requete}`],
  );
  const utilisateurs = useAsync(listBookableUsers, []);

  // `reservations.data` porte deux choses : les lignes chargées et le nombre
  // de celles que le plafond a laissées de côté.
  const chargees = reservations.data?.reservations ?? [];
  const reste = reservations.data?.reste ?? 0;
  const lignes = useMemo(() => chargees.map(toRow), [chargees]);
  const table = useDataTable(lignes, { pageSize: 15, initialSort: { key: 'start', direction: 'desc' } });

  const { envoi, creer, annuler } = useBookingActions({ onDone: () => rafraichir() });

  const rafraichir = async () => {
    const reponse = await reservations.reload();
    if (selection) {
      setSelection(reponse?.reservations?.find((item) => item.id === selection.id) ?? null);
    }
    table.viderSelection();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Toutes les réservations"
        subtitle="Toutes salles et tous utilisateurs confondus, quelle qu’en soit l’origine."
        actions={
          <>
            <SegmentedControl
              label="Mode d’affichage"
              options={AFFICHAGES}
              value={affichage}
              onChange={setAffichage}
            />
            <PermissionGate permission="conflicts.arbitrate">
              <Button icon={CalendarPlus} onClick={() => setCreation(true)}>
                Créer
              </Button>
            </PermissionGate>
          </>
        }
      />

      <FilterBar filters={filtres.filters} active={filtres.active} onReset={filtres.reset}>
        <SearchInput
          label="Rechercher une réservation"
          placeholder="Objet, salle, organisateur"
          value={recherche}
          onChange={setRecherche}
        />
      </FilterBar>

      {reste > 0 && (
        <Callout tone="warning">
          {plural(reste, 'réservation')} au-delà du volume chargé ne {reste > 1 ? 'sont' : 'est'} pas
          {' '}dans cette liste. Filtrez par salle, bâtiment ou période pour les atteindre.
        </Callout>
      )}

      <BookingsWorkspace
        query={reservations}
        bookings={chargees}
        rows={lignes}
        table={table}
        view={affichage}
        selection={selection}
        onSelect={setSelection}
        onCancel={(booking) => setAnnulation({ ids: [booking.id] })}
        onReset={filtres.reset}
      />

      <PermissionGate permission="conflicts.arbitrate">
        <BulkActionBar
          count={table.selection.length}
          label="réservation sélectionnée"
          labelPlural="réservations sélectionnées"
          onClear={table.viderSelection}
          actions={[
            {
              id: 'annuler',
              label: 'Annuler',
              icon: CalendarX2,
              tone: 'danger',
              onClick: () => setAnnulation({ ids: table.selection }),
            },
          ]}
        />
      </PermissionGate>

      <AdminBookingModal
        open={creation}
        onClose={() => setCreation(false)}
        onSubmit={async (donnees) => {
          const ok = await creer(donnees);
          if (ok) setCreation(false);
        }}
        rooms={referentiels.data?.rooms ?? []}
        users={utilisateurs.data ?? []}
        loading={envoi}
      />

      <CancelBookingModal
        open={Boolean(annulation)}
        onClose={() => setAnnulation(null)}
        onConfirm={async (donnees) => {
          const ok = await annuler(annulation.ids, donnees);
          if (ok) setAnnulation(null);
        }}
        count={annulation?.ids.length ?? 1}
        loading={envoi}
      />
    </div>
  );
}

/** Champs de la barre de filtres, alimentés par les référentiels de l'API. */
function champsDeFiltre(referentiels) {
  if (!referentiels) return [];
  return [
    { id: 'roomId', label: 'Salle', options: referentiels.rooms },
    { id: 'buildingId', label: 'Bâtiment', options: referentiels.buildings },
    { id: 'status', label: 'Statut', options: referentiels.statuses },
    { id: 'source', label: 'Source', options: referentiels.sources },
  ];
}
