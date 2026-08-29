import { useEffect, useState } from 'react';
import { getRules, previewImpact, updateRules } from '../../../api/admin/rules';
import { listRoomFilters } from '../../../api/admin/rooms';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Select } from '../../../components/ui/Form';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { SaveBar } from '../../../components/admin/SaveBar';
import { ImpactPanel } from '../../../components/admin/rules/ImpactPanel';
import { RulesForm } from '../../../components/admin/rules/RulesForm';

/**
 * A-10 — Règles de réservation.
 *
 * Deux portées : les règles globales, et la surcharge d'une salle précise.
 * L'encart d'impact est recalculé pendant la saisie, sans attendre
 * l'enregistrement : c'est lui qui révèle une incohérence avant qu'elle
 * n'atteigne les utilisateurs.
 */
export default function BookingRulesPage() {
  useDocumentTitle('Règles de réservation');
  const toast = useToast();

  const [portee, setPortee] = useState('global');
  const [draft, setDraft] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const regles = useAsync(() => getRules(portee), [portee]);
  const referentiels = useAsync(listRoomFilters, []);

  useEffect(() => {
    if (regles.data) setDraft(regles.data);
  }, [regles.data]);

  const impact = useAsync(
    () => (draft ? previewImpact(draft) : Promise.resolve(null)),
    [draft ? JSON.stringify(draft) : ''],
  );

  const modifie = draft && regles.data && JSON.stringify(draft) !== JSON.stringify(regles.data);
  const conflit = incoherence(draft);

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      const majour = await updateRules(portee, draft);
      regles.setData(majour);
      setDraft(majour);
      toast.success(
        'Règles enregistrées',
        portee === 'global'
          ? 'Elles s’appliquent à toutes les salles sans surcharge.'
          : 'Elles ne s’appliquent qu’à cette salle.',
      );
    } catch (erreur) {
      toast.error('Enregistrement refusé', erreur.message);
    } finally {
      setEnregistrement(false);
    }
  };

  const libellePortee =
    portee === 'global'
      ? 'toutes les salles'
      : (referentiels.data?.rooms.find((room) => room.value === portee)?.label ?? portee);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Règles de réservation"
        subtitle="Durées, quotas et validation de présence appliqués au tunnel de réservation."
        actions={
          <Select
            label="Portée"
            options={[
              { value: 'global', label: 'Règles globales' },
              ...(referentiels.data?.rooms ?? []).map((room) => ({
                value: room.value,
                label: `Surcharge — ${room.label}`,
              })),
            ]}
            value={portee}
            onChange={(event) => setPortee(event.target.value)}
            className="min-w-[15rem]"
          />
        }
      />

      <AsyncBoundary
        status={regles.status}
        error={regles.error}
        onRetry={regles.reload}
        skeleton={<SkeletonCard />}
      >
        {/* Le panneau d'impact est collant au bureau, simple section empilée
            en dessous : superposé au contenu sur un écran étroit, il masquait
            les réglages qu'il commente. */}
        {draft && (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <RulesForm
              draft={draft}
              scopeLabel={libellePortee}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
            <ImpactPanel impact={impact.data} loading={impact.isLoading} conflit={conflit} />
          </div>
        )}
      </AsyncBoundary>

      <SaveBar
        dirty={Boolean(modifie)}
        saving={enregistrement}
        valid={!conflit}
        message={conflit}
        onCancel={() => setDraft(regles.data)}
        onSave={enregistrer}
      />
    </div>
  );
}

/**
 * Mêmes contrôles que l'API, joués pendant la saisie pour que l'incohérence
 * s'affiche à la frappe plutôt qu'au refus de l'enregistrement.
 */
function incoherence(regles) {
  if (!regles) return null;
  if (regles.minDurationMin < 15) return 'La durée minimale ne peut pas descendre sous 15 min.';
  if (regles.maxDurationMin <= regles.minDurationMin) {
    return 'La durée maximale doit dépasser la durée minimale.';
  }
  if (regles.weeklyQuotaHours * 60 < regles.maxDurationMin) {
    return 'Le quota hebdomadaire est inférieur à la durée d’une seule réservation maximale.';
  }
  if (regles.checkInWindowMin < 5) return 'La fenêtre de validation doit valoir au moins 5 min.';
  return null;
}
