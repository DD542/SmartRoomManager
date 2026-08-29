import { useEffect, useState } from 'react';
import {
  listTemplates,
  listVariables,
  render,
  saveTemplate,
  sendTest,
  toggleTemplate,
  unknownVariables,
} from '../../../api/admin/templates';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Pill } from '../../../components/ui/Badge';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { SaveBar } from '../../../components/admin/SaveBar';
import { TemplateEditor } from '../../../components/admin/support/TemplateEditor';
import { TemplatePreview } from '../../../components/admin/support/TemplatePreview';

/**
 * A-15 — Modèles d'e-mails.
 *
 * Un modèle désactivé n'est plus envoyé du tout : la bascule est donc immédiate
 * et distincte de l'enregistrement du texte, qui passe par la barre du bas.
 */
export default function EmailTemplatesPage() {
  useDocumentTitle('Modèles d’e-mails');
  const toast = useToast();

  const [selectionId, setSelectionId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [test, setTest] = useState(false);

  const modeles = useAsync(listTemplates, []);
  const variables = useAsync(listVariables, []);

  const courant = (modeles.data ?? []).find((item) => item.id === selectionId) ?? modeles.data?.[0];

  useEffect(() => {
    if (courant && (!draft || draft.id !== courant.id)) {
      setDraft({ id: courant.id, subject: courant.subject, body: courant.body });
    }
  }, [courant, draft]);

  const modifie =
    draft && courant && (draft.subject !== courant.subject || draft.body !== courant.body);
  const inconnues = draft
    ? [...unknownVariables(draft.subject), ...unknownVariables(draft.body)]
    : [];

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await saveTemplate(courant.id, { subject: draft.subject, body: draft.body });
      toast.success('Modèle enregistré', courant.name);
      await modeles.reload();
    } catch (erreur) {
      toast.error('Enregistrement refusé', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const basculer = async (actif) => {
    try {
      await toggleTemplate(courant.id, actif);
      toast.info(
        actif ? 'Modèle réactivé' : 'Modèle désactivé',
        actif ? undefined : 'Aucun e-mail ne sera envoyé pour cet événement.',
      );
      await modeles.reload();
    } catch (erreur) {
      toast.error('Changement refusé', erreur.message);
    }
  };

  const tester = async (email) => {
    setTest(true);
    try {
      const resultat = await sendTest(courant.id, email);
      toast.success('E-mail de test envoyé', `${resultat.sentTo} — « ${resultat.subject} »`);
    } catch (erreur) {
      toast.error('Envoi impossible', erreur.message);
    } finally {
      setTest(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Modèles d’e-mails"
        subtitle="Messages envoyés automatiquement aux utilisateurs."
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {(modeles.data ?? []).map((modele) => (
          <Pill
            key={modele.id}
            active={courant?.id === modele.id}
            onClick={() => setSelectionId(modele.id)}
          >
            {modele.name}
            {!modele.enabled && <span className="text-content-faint"> · inactif</span>}
          </Pill>
        ))}
      </div>

      <AsyncBoundary
        status={modeles.status}
        error={modeles.error}
        onRetry={modeles.reload}
        skeleton={<SkeletonCard />}
      >
        {courant && draft && (
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
            <TemplateEditor
              template={courant}
              draft={draft}
              variables={variables.data ?? []}
              unknown={inconnues}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onToggle={basculer}
            />
            <TemplatePreview
              subject={render(draft.subject)}
              body={render(draft.body)}
              onTest={tester}
              busy={test}
            />
          </div>
        )}
      </AsyncBoundary>

      <SaveBar
        dirty={Boolean(modifie)}
        saving={envoi}
        valid={inconnues.length === 0}
        message={
          inconnues.length > 0
            ? `Variable inconnue : {{${inconnues[0]}}}.`
            : undefined
        }
        onCancel={() =>
          setDraft({ id: courant.id, subject: courant.subject, body: courant.body })
        }
        onSave={enregistrer}
      />
    </div>
  );
}
