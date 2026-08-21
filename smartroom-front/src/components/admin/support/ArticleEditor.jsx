import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Card';
import { Input, Select, Textarea } from '../../ui/Form';

const VIERGE = { title: '', excerpt: '', body: '', category: '', related: [] };

/** Seuil de publication appliqué par l'API : un article plus court est refusé. */
const LONGUEUR_MIN = 40;

/**
 * A-14 — rédaction d'un article d'aide.
 *
 * Le compteur de caractères annonce le seuil de publication avant l'envoi :
 * découvrir « article trop court » au moment de publier serait une perte de
 * temps évitable.
 */
export function ArticleEditor({ open, onClose, onSubmit, article, categories = [], loading = false }) {
  const [form, setForm] = useState(VIERGE);

  useEffect(() => {
    if (open) setForm(article ? { ...VIERGE, ...article } : VIERGE);
  }, [open, article]);

  const modifier = (patch) => setForm((current) => ({ ...current, ...patch }));
  const trop_court = form.body.trim().length < LONGUEUR_MIN;
  const incomplet = !form.title.trim() || !form.body.trim() || !form.category;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={FileText}
      tone="accent"
      size="lg"
      title={article?.id ? 'Modifier l’article' : 'Nouvel article'}
      description="Les articles publiés alimentent le centre d’aide et les réponses du chatbot."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={incomplet} onClick={() => onSubmit(form)}>
            {article?.id ? 'Enregistrer' : 'Créer le brouillon'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Titre"
          required
          placeholder="Comment annuler une réservation ?"
          value={form.title}
          onChange={(event) => modifier({ title: event.target.value })}
        />

        <Select
          label="Catégorie"
          required
          placeholder="Choisir une catégorie"
          options={categories.map((item) => ({ value: item.id, label: item.label }))}
          value={form.category}
          onChange={(event) => modifier({ category: event.target.value })}
        />

        <Input
          label="Accroche"
          hint="Facultative : reprise des 90 premiers caractères si elle est vide."
          value={form.excerpt}
          onChange={(event) => modifier({ excerpt: event.target.value })}
        />

        <Textarea
          label="Contenu"
          required
          rows={8}
          value={form.body}
          hint={`${form.body.trim().length} caractères — ${LONGUEUR_MIN} minimum pour publier.`}
          onChange={(event) => modifier({ body: event.target.value })}
        />

        {trop_court && form.body.trim().length > 0 && (
          <Callout tone="warning">
            L’article pourra être enregistré en brouillon, mais pas publié tant qu’il n’atteint pas{' '}
            {LONGUEUR_MIN} caractères.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
