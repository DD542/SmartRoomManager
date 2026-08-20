import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, DoorOpen, LifeBuoy, Search, CalendarCheck } from 'lucide-react';
import { globalSearch } from '../../api/search';
import { useAsync } from '../../hooks/useAsync';
import { plural } from '../../utils/format';
import { Badge, Pill } from '../../components/ui/Badge';
import { Card, SectionTitle } from '../../components/ui/Card';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { StaggerList } from '../../components/ui/StaggerList';
import { PageHeader } from '../../components/layout/PageHeader';

const GROUP_ICONS = { salles: DoorOpen, reservations: CalendarCheck, aide: LifeBuoy };
const TONE = { success: 'success', danger: 'danger', muted: 'muted', default: 'default' };

/** U-25 — Recherche globale : salles, réservations et articles d'aide. */
export default function GlobalSearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  const [group, setGroup] = useState('tout');

  useEffect(() => {
    document.title = query ? `Recherche : ${query} — SmartRoom Manager` : 'Recherche — SmartRoom Manager';
  }, [query]);

  const results = useAsync(() => globalSearch(query), [query]);

  const groups = useMemo(() => {
    const all = results.data?.groups ?? [];
    return group === 'tout' ? all : all.filter((item) => item.id === group);
  }, [results.data, group]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Recherche globale" />

      <Card className="p-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setParams(input.trim() ? { q: input.trim() } : {});
          }}
          role="search"
        >
          <label htmlFor="recherche-globale-page" className="sr-only">
            Rechercher une salle, une réservation ou un article
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
            />
            <input
              id="recherche-globale-page"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Salle, réservation, article d’aide…"
              className="h-10 w-full rounded-xl border border-line bg-surface-raised pl-10 pr-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
            />
          </div>
        </form>

        {results.isSuccess && query && (
          <p className="mt-2 px-1 text-xs text-content-muted">
            {plural(results.data.total, 'résultat trouvé', 'résultats trouvés')} pour{' '}
            <span className="font-medium text-content">« {query} »</span>
          </p>
        )}
      </Card>

      {results.data?.groups?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Pill active={group === 'tout'} onClick={() => setGroup('tout')}>
            Tout
          </Pill>
          {results.data.groups.map((item) => (
            <Pill
              key={item.id}
              active={group === item.id}
              count={item.count}
              onClick={() => setGroup(item.id)}
            >
              {item.label}
            </Pill>
          ))}
        </div>
      )}

      <AsyncBoundary
        status={query ? results.status : 'succes'}
        error={results.error}
        onRetry={results.reload}
        isEmpty={!query || (results.isSuccess && (results.data?.total ?? 0) === 0)}
        skeleton={
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        }
        empty={
          <Card>
            <EmptyState
              icon={Search}
              title={query ? 'Aucun résultat' : 'Que cherchez-vous ?'}
              description={
                query
                  ? 'Vérifiez l’orthographe ou essayez un terme plus court, comme le nom d’une salle.'
                  : 'Saisissez au moins deux caractères pour lancer la recherche.'
              }
            />
          </Card>
        }
      >
        <div className="flex flex-col gap-4">
          {groups.map((section) => {
            const Icon = GROUP_ICONS[section.id] ?? Search;
            return (
              <Card key={section.id}>
                <SectionTitle title={`${section.label} (${section.count})`} icon={Icon} className="px-4 py-3" />
                <StaggerList className="flex flex-col gap-2 px-4 pb-4">
                  {section.items.map((item) => (
                    <Link
                      key={item.id}
                      to={item.to}
                      className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5 transition hover:border-accent/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm text-content ${
                            item.strikethrough ? 'line-through opacity-70' : ''
                          }`}
                        >
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-content-muted">{item.subtitle}</span>
                      </span>
                      {item.badge && <Badge tone={TONE[item.tone] ?? 'default'} dot>{item.badge}</Badge>}
                      <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-content-muted" />
                    </Link>
                  ))}
                </StaggerList>
              </Card>
            );
          })}
        </div>
      </AsyncBoundary>
    </div>
  );
}
