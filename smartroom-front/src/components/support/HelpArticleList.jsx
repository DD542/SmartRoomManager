import { ChevronDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtDate } from '../../utils/dates';
import { StaggerList } from '../ui/StaggerList';

/**
 * U-22 — liste d'articles dépliables.
 *
 * Un seul article ouvert à la fois : le contenu reste dans le flux, aucune
 * navigation ne casse le fil de la recherche. Chaque en-tête est un bouton,
 * donc utilisable au clavier, et porte `aria-expanded`.
 */
export function HelpArticleList({ articles = [], openId, onToggle, related = [], onOpenRelated }) {
  return (
    <StaggerList className="flex flex-col gap-2">
      {articles.map((article) => {
        const open = article.id === openId;
        const relations = open ? related : [];

        return (
          <article
            key={article.id}
            id={`article-${article.id}`}
            className={cn(
              'overflow-hidden rounded-xl border transition',
              open ? 'border-accent/40 bg-surface-raised' : 'border-line bg-surface-raised',
            )}
          >
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`corps-${article.id}`}
                onClick={() => onToggle(open ? null : article.id)}
                className="flex w-full items-start justify-between gap-4 px-3.5 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-content">{article.title}</span>
                  {!open && (
                    <span className="mt-0.5 block truncate text-xs text-content-muted">
                      {article.excerpt}
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 shrink-0 text-content-muted transition-transform',
                    open && 'rotate-180 text-accent',
                  )}
                />
              </button>
            </h3>

            {open && (
              <div id={`corps-${article.id}`} className="animate-fade-in-up px-3.5 pb-3.5">
                <p className="text-xs leading-relaxed text-content-muted">{article.body}</p>

                {relations.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-[11px] uppercase tracking-wide text-content-faint">
                      À lire aussi
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {relations.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => onOpenRelated(item.id)}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-content-muted transition hover:border-accent/50 hover:text-content"
                          >
                            {item.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <p className="font-mono text-[10px] text-content-faint">
                    Mis à jour le {fmtDate(article.updatedAt)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onToggle(null)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-content-muted transition hover:border-success/50 hover:text-success"
                  >
                    <ThumbsUp size={11} aria-hidden="true" />
                    Cet article m’a aidé
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </StaggerList>
  );
}
