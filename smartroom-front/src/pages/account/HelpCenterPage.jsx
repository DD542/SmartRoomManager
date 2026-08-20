import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarPlus, KeyRound, LifeBuoy, Monitor, Plus, Search, User, XCircle } from 'lucide-react';
import { createTicket, getTicket, listHelpCategories, listTickets, listTicketCategories, searchHelpArticles } from '../../api/tickets';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { fmtRelative } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { StaggerList } from '../../components/ui/StaggerList';
import { PageHeader } from '../../components/layout/PageHeader';
import { TicketTable } from '../../components/support/TicketTable';
import { NewTicketModal, TicketThreadModal } from '../../components/support/TicketModals';

const CATEGORY_ICONS = { CalendarPlus, KeyRound, XCircle, Monitor, User };

/** U-22 — Centre d'aide : recherche d'articles, catégories et suivi des tickets. */
export default function HelpCenterPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [openTicket, setOpenTicket] = useState(null);
  const [newTicket, setNewTicket] = useState(null);

  useEffect(() => {
    document.title = 'Centre d’aide — SmartRoom Manager';
    const id = params.get('ticket');
    if (id) getTicket(id).then(setOpenTicket).catch(() => setOpenTicket(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useAsync(listHelpCategories, []);
  const ticketCategories = useAsync(listTicketCategories, []);
  const articles = useAsync(() => searchHelpArticles(query), [query]);
  const tickets = useAsync(listTickets, []);

  const submitTicket = async () => {
    try {
      await createTicket(newTicket);
      toast.success('Demande envoyée', 'Le support répond sous 24 h ouvrées.');
      setNewTicket(null);
      tickets.reload();
    } catch (error) {
      toast.error('Envoi impossible', error.message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Centre d’aide" />

      <Card className="px-4 py-8 text-center">
        <h2 className="text-xl font-semibold text-content">Comment pouvons-nous vous aider ?</h2>
        <div className="relative mx-auto mt-4 max-w-lg">
          <label htmlFor="recherche-aide" className="sr-only">
            Rechercher un article d’aide
          </label>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
          />
          <input
            id="recherche-aide"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher des articles, des guides ou des questions fréquentes…"
            className="h-11 w-full rounded-xl border border-line bg-surface-raised pl-10 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
          />
        </div>
      </Card>

      {query.length === 0 && (
        <section>
          <h2 className="text-sm font-semibold text-content">Catégories d’aide</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(categories.data ?? []).map((category) => {
              const Icon = CATEGORY_ICONS[category.icon] ?? LifeBuoy;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setQuery(category.label.split(' ')[0])}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-line-strong"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-raised">
                    <Icon size={16} aria-hidden="true" className="text-accent" />
                  </span>
                  <span>
                    <span className="block text-sm text-content">{category.label}</span>
                    <span className="block text-xs text-content-muted">{category.count} articles</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {query.length > 0 && (
        <Card>
          <CardHeader title={`Résultats pour « ${query} »`} />
          <AsyncBoundary
            status={articles.status}
            error={articles.error}
            onRetry={articles.reload}
            isEmpty={articles.isSuccess && (articles.data ?? []).length === 0}
            skeleton={<Skeleton className="m-4 h-24" />}
            empty={
              <EmptyState
                icon={LifeBuoy}
                title="Aucun article trouvé"
                description="Reformulez votre recherche ou ouvrez une demande d’assistance."
                action={
                  <Button size="sm" onClick={() => setNewTicket({ subject: query, category: 'compte', body: '' })}>
                    Ouvrir une demande
                  </Button>
                }
              />
            }
          >
            <StaggerList className="flex flex-col gap-2 px-4 pb-4">
              {(articles.data ?? []).map((article) => (
                <details key={article.id} className="rounded-xl border border-line bg-surface-raised px-3 py-2.5">
                  <summary className="cursor-pointer text-sm text-content">{article.title}</summary>
                  <p className="mt-2 text-xs leading-relaxed text-content-muted">{article.body}</p>
                  <p className="mt-2 font-mono text-[10px] text-content-faint">
                    Mis à jour {fmtRelative(article.updatedAt)}
                  </p>
                </details>
              ))}
            </StaggerList>
          </AsyncBoundary>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Mes demandes"
          subtitle="Suivez l’état de vos tickets de support récents."
          action={
            <Button
              size="sm"
              icon={Plus}
              onClick={() => setNewTicket({ subject: '', category: 'acces', body: '' })}
            >
              Nouvelle demande d’aide
            </Button>
          }
        />
        <AsyncBoundary
          status={tickets.status}
          error={tickets.error}
          onRetry={tickets.reload}
          isEmpty={tickets.isSuccess && (tickets.data ?? []).length === 0}
          skeleton={<Skeleton className="m-4 h-24" />}
          empty={<EmptyState icon={LifeBuoy} title="Aucune demande en cours" />}
        >
          <TicketTable
            tickets={tickets.data ?? []}
            onOpen={(ticket) => {
              setOpenTicket(ticket);
              setParams({ ticket: ticket.id });
            }}
          />
        </AsyncBoundary>
      </Card>

      <TicketThreadModal
        ticket={openTicket}
        onClose={() => {
          setOpenTicket(null);
          setParams({});
        }}
      />

      <NewTicketModal
        draft={newTicket}
        categories={ticketCategories.data ?? []}
        onChange={(patch) => setNewTicket((current) => ({ ...current, ...patch }))}
        onClose={() => setNewTicket(null)}
        onSubmit={submitTicket}
      />
    </div>
  );
}
