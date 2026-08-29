import { useState } from 'react';
import { Inbox, MapPin } from 'lucide-react';
import { arbitrate, countQueue, getQueueItem, listQueue } from '../../../api/admin/conflicts';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { PileInspecteur } from '../../../components/admin/PileInspecteur';
import { Badge } from '../../../components/ui/Badge';
import { Card, CardHeader } from '../../../components/ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { AlternativeList } from '../../../components/admin/conflicts/AlternativeList';
import { ArbitrationPanel } from '../../../components/admin/conflicts/ArbitrationPanel';
import { ClaimantCompare } from '../../../components/admin/conflicts/ClaimantCompare';
import { OverlapTimeline } from '../../../components/admin/conflicts/OverlapTimeline';
import { QueueList } from '../../../components/admin/conflicts/QueueList';
import { fmtDateLong, fmtRelative } from '../../../utils/dates';

/**
 * A-04 — File des conflits, demandes d'accès et validations.
 *
 * Le détail est rechargé depuis l'API à chaque sélection : c'est lui qui porte
 * les alternatives calculées par le moteur de recommandation, jamais la liste.
 */
export default function ConflictQueuePage() {
  useDocumentTitle('File des conflits');
  const toast = useToast();

  const [onglet, setOnglet] = useState('tous');
  const [selectionId, setSelectionId] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const file = useAsync(() => listQueue(onglet), [onglet]);
  const compteurs = useAsync(countQueue, []);
  const detail = useAsync(
    () => (selectionId ? getQueueItem(selectionId) : Promise.resolve(null)),
    [selectionId],
  );

  const decider = async (decision) => {
    setEnvoi(true);
    try {
      const resultat = await arbitrate(selectionId, decision);
      toast.success(
        'Décision enregistrée',
        `${resultat.id} — ${LIBELLE_DECISION[resultat.decision] ?? resultat.decision}.`,
      );
      setSelectionId(null);
      await Promise.all([file.reload(), compteurs.reload()]);
    } catch (erreur) {
      toast.error('Arbitrage impossible', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const item = detail.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Conflits et demandes"
        subtitle="Chaque élément attend une décision : maintien, repli ou refus."
        actions={
          compteurs.data && (
            <Badge tone={compteurs.data.tous > 0 ? 'warning' : 'success'} dot>
              {compteurs.data.tous} en attente
            </Badge>
          )
        }
      />

      <PileInspecteur
        className="lg:grid-cols-[22rem_1fr]"
        actif={Boolean(selectionId)}
        onRetour={() => setSelectionId(null)}
        libelleRetour="Retour à la file"
        liste={
          <AsyncBoundary
          status={file.status}
          error={file.error}
          onRetry={file.reload}
          skeleton={<SkeletonCard />}
        >
          <Card className="overflow-hidden lg:sticky lg:top-4">
            <QueueList
              items={file.data ?? []}
              counts={compteurs.data ?? {}}
              tab={onglet}
              onTabChange={(valeur) => {
                setOnglet(valeur);
                setSelectionId(null);
              }}
              selectedId={selectionId}
              onSelect={(element) => setSelectionId(element.id)}
            />
          </Card>
        </AsyncBoundary>
        }
        detail={
          !selectionId ? (
          <Card>
            <EmptyState
              icon={Inbox}
              title="Aucun élément sélectionné"
              description="Choisissez une ligne dans la file pour comparer les demandeurs et arbitrer."
            />
          </Card>
        ) : (
          <AsyncBoundary
            status={detail.status}
            error={detail.error}
            onRetry={detail.reload}
            skeleton={<SkeletonCard />}
          >
            {item && <Detail item={item} onDecide={decider} loading={envoi} />}
          </AsyncBoundary>
          )
        }
      />
    </div>
  );
}

const LIBELLE_DECISION = {
  maintien: 'réservation initiale maintenue',
  alternative: 'demandeur réorienté',
  refus: 'demande refusée',
};

function Detail({ item, onDecide, loading }) {
  const conflit = item.type.startsWith('conflit');
  const compare = item.claimants.length >= 2;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={item.title}
          subtitle={`${item.reference ?? item.id} · déposé ${fmtRelative(item.createdAt)}`}
          icon={MapPin}
        />
        <div className="flex flex-col gap-3 px-4 pb-4">
          {item.room && (
            <p className="text-xs text-content-muted">
              {item.room.name}
              {item.room.capacity ? ` — capacité ${item.room.capacity} places` : ''}
            </p>
          )}
          {item.detail && <p className="text-sm text-content">{item.detail}</p>}

          {compare && (
            <>
              <OverlapTimeline claimants={item.claimants} roomName={item.room?.name ?? ''} />
              <p className="text-xs text-content-faint">
                Créneau contesté le {fmtDateLong(item.claimants[0].start)}.
              </p>
              <ClaimantCompare claimants={item.claimants} />
            </>
          )}
        </div>
      </Card>

      {!compare && item.alternatives.length > 0 && (
        <Card>
          <CardHeader
            title="Salles disponibles sur ce créneau"
            subtitle="Classement issu du moteur de recommandation"
          />
          <div className="px-4 pb-4">
            <AlternativeList alternatives={item.alternatives} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Arbitrage" subtitle="La décision est journalisée et notifiée." />
        <div className="px-4 pb-4">
          <ArbitrationPanel
            variant={conflit ? 'conflit' : 'demande'}
            alternatives={item.alternatives}
            onSubmit={onDecide}
            loading={loading}
          />
        </div>
      </Card>
    </div>
  );
}
