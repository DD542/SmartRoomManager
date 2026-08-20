import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Plus } from 'lucide-react';
import {
  createTicket,
  getTicket,
  listHelpCategories,
  listRelatedArticles,
  listTickets,
  listTicketCategories,
  searchHelpArticles,
} from '../../api/tickets';
import { useAsync } from '../../hooks/useAsync';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useToast } from '../../hooks/useToast';
import { plural } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Badge';
import { AsyncBoundary, EmptyState, Skeleton, Spinner } from '../../components/ui/States';
import { PageHeader } from '../../components/layout/PageHeader';
import { HelpSearch } from '../../components/support/HelpSearch';
import { HelpCategories } from '../../components/support/HelpCategories';
import { HelpArticleList } from '../../components/support/HelpArticleList';
import { MyTicketsCard } from '../../components/support/MyTicketsCard';
import { NewTicketModal, TicketThreadModal } from '../../components/support/TicketModals';

/** U-22 — Centre d'aide : recherche d'articles, catégories et suivi des tickets. */
export default function HelpCenterPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(null);
  const [openArticle, setOpenArticle] = useState(null);
  const [openTicket, setOpenTicket] = useState(null);
  const [newTicket, setNewTicket] = useState(null);

  // La frappe reste fluide : seule la valeur stabilisée déclenche la recherche.
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    document.title = 'Centre d’aide — SmartRoom Manager';
  }, []);

  const ticketParam = params.get('ticket');
  const articleParam = params.get('article');

  useEffect(() => {
    if (ticketParam) getTicket(ticketParam).then(setOpenTicket).catch(() => setOpenTicket(null));
  }, [ticketParam]);

  // Lien profond depuis la recherche globale : /app/aide?article=ha-11.
  // La dépendance au paramètre couvre aussi l'arrivée sur une page déjà montée.
  useEffect(() => {
    if (articleParam) setOpenArticle(articleParam);
  }, [articleParam]);

  const categories = useAsync(listHelpCategories, []);
  const ticketCategories = useAsync(listTicketCategories, []);
  const tickets = useAsync(listTickets, []);
  const articles = useAsync(
    () => searchHelpArticles({ query: debouncedQuery, category }),
    [debouncedQuery, category],
  );
  const related = useAsync(
    () => (openArticle ? listRelatedArticles(openArticle) : Promise.resolve([])),
    [openArticle],
  );

  const openArticleById = (id) => {
    setOpenArticle(id);
    document.getElementById(`article-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const activeCategory = (categories.data ?? []).find((item) => item.id === category);
  const searching = query !== debouncedQuery || articles.isLoading;

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

      <HelpSearch value={query} onChange={setQuery} />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-content">Catégories d’aide</h2>
        <HelpCategories
          categories={categories.data ?? []}
          active={category}
          onSelect={(next) => {
            setCategory(next);
            setOpenArticle(null);
          }}
          isLoading={categories.isLoading}
        />
      </section>

      <Card>
        <CardHeader
          title={activeCategory ? activeCategory.label : 'Tous les articles'}
          subtitle={
            articles.isSuccess ? plural((articles.data ?? []).length, 'article') : 'Chargement…'
          }
          action={
            <div className="flex items-center gap-2">
              {searching && <Spinner label="Recherche…" className="text-xs" />}
              {(category || query) && (
                <Chip
                  label={category ? activeCategory?.label ?? '' : `« ${query} »`}
                  onRemove={() => {
                    setCategory(null);
                    setQuery('');
                  }}
                />
              )}
            </div>
          }
        />

        <div className="px-4 pb-4">
          <AsyncBoundary
            status={articles.status}
            error={articles.error}
            onRetry={articles.reload}
            isEmpty={articles.isSuccess && (articles.data ?? []).length === 0}
            skeleton={
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            }
            empty={
              <EmptyState
                icon={LifeBuoy}
                title="Aucun article ne répond à cette recherche"
                description="Reformulez avec un mot plus simple, ou ouvrez une demande d’assistance."
                action={
                  <Button
                    size="sm"
                    onClick={() =>
                      setNewTicket({ subject: query || '', category: 'compte', body: '' })
                    }
                  >
                    Ouvrir une demande
                  </Button>
                }
              />
            }
          >
            <HelpArticleList
              articles={articles.data ?? []}
              openId={openArticle}
              onToggle={setOpenArticle}
              related={related.data ?? []}
              onOpenRelated={openArticleById}
            />
          </AsyncBoundary>
        </div>
      </Card>

      <MyTicketsCard
        tickets={tickets}
        onOpen={(ticket) => {
          setOpenTicket(ticket);
          setParams({ ticket: ticket.id });
        }}
        onCreate={() => setNewTicket({ subject: '', category: 'acces', body: '' })}
      />

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
