import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import {
  deleteArticle,
  listCategoriesWithCounts,
  listChatbotIntents,
  listManagedArticles,
  saveArticle,
  setArticleStatus,
} from '../../../api/admin/knowledge';
import { useAsync } from '../../../hooks/useAsync';
import { useDataTable } from '../../../hooks/useDataTable';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Pill } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { ArticleEditor } from '../../../components/admin/support/ArticleEditor';
import { ArticlesTable } from '../../../components/admin/support/ArticlesTable';
import { AssistantDashboard } from '../../../components/admin/support/AssistantDashboard';
import { ChatbotIntents } from '../../../components/admin/support/ChatbotIntents';
import { plural } from '../../../utils/format';

/**
 * A-14 — Base de connaissances et chatbot.
 *
 * Publier un article le rend visible dans le centre d'aide de l'espace
 * utilisateur : la liste distingue donc nettement brouillons et articles en
 * ligne, et affiche l'audience réelle de chacun.
 */
export default function KnowledgePage() {
  useDocumentTitle('Base de connaissances');
  const toast = useToast();

  const [categorie, setCategorie] = useState(null);
  const [edition, setEdition] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const articles = useAsync(() => listManagedArticles(categorie), [categorie]);
  const categories = useAsync(listCategoriesWithCounts, []);
  const intentions = useAsync(listChatbotIntents, []);

  const table = useDataTable(articles.data ?? [], {
    pageSize: 10,
    initialSort: { key: 'status', direction: 'asc' },
  });

  const agir = async (action, succes, detail) => {
    setEnvoi(true);
    try {
      await action();
      toast.success(succes, detail);
      await Promise.all([articles.reload(), categories.reload()]);
      return true;
    } catch (erreur) {
      toast.error('Action impossible', erreur.message);
      return false;
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Base de connaissances"
        subtitle="Articles du centre d’aide et scénarios traités automatiquement par le chatbot."
        actions={
          <Button icon={Plus} onClick={() => setEdition({})}>
            Nouvel article
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={categorie === null} onClick={() => setCategorie(null)}>
          Toutes
        </Pill>
        {(categories.data ?? []).map((item) => (
          <Pill
            key={item.id}
            active={categorie === item.id}
            count={item.count}
            onClick={() => setCategorie(item.id)}
          >
            {item.label}
          </Pill>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <AsyncBoundary
          status={articles.status}
          error={articles.error}
          onRetry={articles.reload}
          isEmpty={(articles.data ?? []).length === 0}
          skeleton={<SkeletonCard />}
          empty={
            <Card>
              <EmptyState
                icon={FileText}
                title="Aucun article"
                description="Aucun article dans cette catégorie."
                action={
                  <Button variant="secondary" size="sm" onClick={() => setEdition({})}>
                    Rédiger un article
                  </Button>
                }
              />
            </Card>
          }
        >
          <Card className="overflow-hidden">
            <ArticlesTable
              table={table}
              busy={envoi}
              onEdit={setEdition}
              onToggleStatus={(row) =>
                agir(
                  () => setArticleStatus(row.id, row.status === 'publie' ? 'brouillon' : 'publie'),
                  row.status === 'publie' ? 'Article dépublié' : 'Article publié',
                  row.title,
                )
              }
              onDelete={(row) => agir(() => deleteArticle(row.id), 'Article supprimé', row.title)}
            />
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-content-faint">
              {plural(
                (articles.data ?? []).filter((item) => item.status === 'publie').length,
                'article en ligne',
                'articles en ligne',
              )}{' '}
              dans le centre d’aide.
            </p>
          </Card>
        </AsyncBoundary>

        <ChatbotIntents intents={intentions.data ?? []} />
      </div>

      {/* L'observabilité de l'assistant vit ici plutôt que sur un écran à part :
          les intentions du repli, les articles qu'il cite et ses chiffres se
          règlent ensemble, et les séparer obligerait à naviguer entre deux
          pages pour comprendre une même réponse. */}
      <AssistantDashboard />

      <ArticleEditor
        open={Boolean(edition)}
        onClose={() => setEdition(null)}
        article={edition?.id ? edition : null}
        categories={categories.data ?? []}
        loading={envoi}
        onSubmit={async (form) => {
          const ok = await agir(
            () => saveArticle({ ...form, id: edition?.id }),
            edition?.id ? 'Article enregistré' : 'Brouillon créé',
            form.title,
          );
          if (ok) setEdition(null);
        }}
      />
    </div>
  );
}
