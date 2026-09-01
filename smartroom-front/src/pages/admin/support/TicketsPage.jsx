import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Inbox, PartyPopper } from 'lucide-react';
import {
  countTickets,
  getAdminTicket,
  listAdminTickets,
  listResponseTemplates,
  replyToAdminTicket,
  setTicketStatus,
} from '../../../api/admin/tickets';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { TicketAside } from '../../../components/admin/support/TicketAside';
import { TicketQueue } from '../../../components/admin/support/TicketQueue';
import { TicketThread } from '../../../components/admin/support/TicketThread';
import { plural } from '../../../utils/format';

/**
 * A-13 — Tickets.
 *
 * Trois volets : la file à gauche, le fil au centre, le contexte du demandeur à
 * droite. Le détail est rechargé à chaque sélection — c'est lui qui porte la
 * réservation liée, inutile de la calculer pour toute la liste.
 */
export default function TicketsPage() {
  useDocumentTitle('Tickets');
  const toast = useToast();

  // La sélection vit dans l'adresse, pas seulement dans un état local.
  //
  // `/admin/tickets/:id` figure dans le routeur comme une entrée à part :
  // l'intention était bien d'ouvrir une demande précise. Mais la page ne lisait
  // jamais le paramètre, et l'adresse menaçait à la file avec « Aucun ticket
  // sélectionné ». Un lien vers un ticket — notification, courriel, signet —
  // perdait son ticket, sans que rien ne le signale.
  const { id: idDeLUrl } = useParams();
  const naviguer = useNavigate();

  const [onglet, setOnglet] = useState('ouverts');
  const selectionId = idDeLUrl ?? null;

  /** Ouvrir un ticket change l'adresse : elle redevient partageable. */
  const setSelectionId = (identifiant) =>
    naviguer(identifiant ? `/admin/tickets/${identifiant}` : '/admin/tickets', {
      replace: true,
    });
  const [envoi, setEnvoi] = useState(false);

  const file = useAsync(() => listAdminTickets(onglet), [onglet]);
  const compteurs = useAsync(countTickets, []);
  const modeles = useAsync(listResponseTemplates, []);
  const detail = useAsync(
    () => (selectionId ? getAdminTicket(selectionId) : Promise.resolve(null)),
    [selectionId],
  );

  const rafraichir = () => Promise.all([detail.reload(), file.reload(), compteurs.reload()]);

  const repondre = async (payload) => {
    setEnvoi(true);
    try {
      await replyToAdminTicket(selectionId, payload);
      toast.success(
        payload.internal ? 'Note interne ajoutée' : 'Réponse envoyée',
        payload.resolve ? 'Le ticket est marqué comme résolu.' : undefined,
      );
      await rafraichir();
      return true;
    } catch (erreur) {
      toast.error('Envoi impossible', erreur.message);
      return false;
    } finally {
      setEnvoi(false);
    }
  };

  const changerStatut = async (statut) => {
    setEnvoi(true);
    try {
      await setTicketStatus(selectionId, statut);
      await rafraichir();
    } catch (erreur) {
      toast.error('Changement refusé', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const modelesDuTicket = (modeles.data ?? []).filter(
    (modele) => !detail.data || modele.category === detail.data.category,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tickets"
        subtitle="Demandes d’aide des utilisateurs, du signalement à la résolution."
        actions={
          compteurs.data && (
            <Badge tone={compteurs.data.ouverts > 0 ? 'warning' : 'success'} dot>
              {plural(compteurs.data.ouverts, 'ticket ouvert', 'tickets ouverts')}
            </Badge>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[20rem_1fr_18rem] [&>*]:min-w-0">
        <AsyncBoundary
          status={file.status}
          error={file.error}
          onRetry={file.reload}
          isEmpty={(file.data ?? []).length === 0}
          skeleton={<SkeletonCard />}
          empty={
            <Card>
              <EmptyState
                icon={PartyPopper}
                title="File vide"
                description="Aucun ticket dans cet onglet."
              />
            </Card>
          }
        >
          <Card className="overflow-hidden xl:sticky xl:top-4">
            <TicketQueue
              tickets={file.data ?? []}
              counts={compteurs.data ?? {}}
              tab={onglet}
              onTabChange={(valeur) => {
                setOnglet(valeur);
                setSelectionId(null);
              }}
              selectedId={selectionId}
              onSelect={(ticket) => setSelectionId(ticket.id)}
            />
          </Card>
        </AsyncBoundary>

        {!selectionId ? (
          <Card className="xl:col-span-2">
            <EmptyState
              icon={Inbox}
              title="Aucun ticket sélectionné"
              description="Choisissez une demande dans la file pour ouvrir son fil de discussion."
            />
          </Card>
        ) : (
          <AsyncBoundary
            status={detail.status}
            error={detail.error}
            onRetry={detail.reload}
            skeleton={<SkeletonCard />}
          >
            {detail.data && (
              <>
                <TicketThread
                  ticket={detail.data}
                  templates={modelesDuTicket}
                  onReply={repondre}
                  busy={envoi}
                />
                <TicketAside ticket={detail.data} onStatus={changerStatut} busy={envoi} />
              </>
            )}
          </AsyncBoundary>
        )}
      </div>
    </div>
  );
}
