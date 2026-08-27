import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Image as ImageIcon, Layers, Plus, Trash2, Upload } from 'lucide-react';
import {
  createBuilding,
  createFloor,
  deleteBuilding,
  deleteFloor,
  listFloorsWithRooms,
  listManagedBuildings,
  removeBuildingImage,
  updateBuilding,
  updateFloor,
  uploadBuildingImage,
  TYPES_IMAGE,
} from '../../../api/admin/buildings';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button, IconButton } from '../../../components/ui/Button';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Form';
import { Modal } from '../../../components/ui/Modal';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { SaveBar } from '../../../components/admin/SaveBar';
import { BuildingCard } from '../../../components/admin/buildings/BuildingCard';
import { FloorAccordion } from '../../../components/admin/buildings/FloorAccordion';
import { FloorPlanModal } from '../../../components/admin/buildings/FloorPlanModal';

/**
 * Gestion du parc immobilier : bâtiments, étages, et les salles qu'ils portent.
 *
 * L'écran manquait, et son absence se voyait ailleurs : l'API ne savait que
 * *lire* les bâtiments, si bien qu'ils venaient du jeu de démonstration et de
 * nulle part une fois l'application déployée. Créer une salle demandait un
 * étage qu'aucun écran ne permettait de déclarer.
 *
 * La disposition suit la question posée : la liste à gauche répond à « quels
 * bâtiments », le détail à droite à « que contient celui-ci ». Les salles y
 * sont consultables sans quitter l'écran, et chacune indique si elle porte un
 * plan de localisation — l'information qui manque le plus souvent.
 */
export default function BuildingsPage() {
  useDocumentTitle('Bâtiments');
  const toast = useToast();
  const navigate = useNavigate();

  const parc = useAsync(listManagedBuildings, []);
  const [choisiId, setChoisiId] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [creation, setCreation] = useState(false);
  const [etageEnCours, setEtageEnCours] = useState(null);
  const [planOuvert, setPlanOuvert] = useState(null);
  const [fiche, setFiche] = useState(null);

  const batiments = parc.data ?? [];
  const choisi = batiments.find((item) => item.id === choisiId) ?? null;

  // Le premier bâtiment est retenu d'office : un panneau de détail vide au
  // chargement obligerait à un clic pour voir ce que l'écran a déjà chargé.
  useEffect(() => {
    if (!choisiId && batiments.length > 0) setChoisiId(batiments[0].id);
  }, [batiments, choisiId]);

  const etages = useAsync(
    (options) => (choisiId ? listFloorsWithRooms(choisiId, options ?? {}) : Promise.resolve([])),
    [choisiId],
  );

  useEffect(() => setFiche(choisi ? { ...choisi } : null), [choisi]);

  const modifie =
    fiche !== null &&
    choisi !== null &&
    (fiche.name !== choisi.name || (fiche.address ?? '') !== (choisi.address ?? ''));

  const agir = async (action, succes) => {
    setEnvoi(true);
    try {
      const resultat = await action();
      await parc.reload();
      toast.success(succes);
      return resultat;
    } catch (erreur) {
      toast.error('Action impossible', erreur.message);
      throw erreur;
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bâtiments"
        subtitle="Le parc immobilier : bâtiments, niveaux, et les salles qu’ils portent."
        actions={
          <Button icon={Plus} onClick={() => setCreation(true)}>
            Nouveau bâtiment
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardHeader title="Le parc" subtitle={`${batiments.length} bâtiment(s)`} icon={Building2} />
          <AsyncBoundary
            status={parc.status}
            error={parc.error}
            onRetry={parc.reload}
            isEmpty={batiments.length === 0}
            skeleton={<SkeletonCard />}
            empty={
              <EmptyState
                icon={Building2}
                title="Aucun bâtiment"
                description="Déclarez un premier bâtiment : une salle se rattache à un étage, qui se rattache à un bâtiment."
              />
            }
          >
            <div className="flex flex-col gap-2 px-3 pb-3">
              {batiments.map((item) => (
                <BuildingCard
                  key={item.id}
                  building={item}
                  active={item.id === choisiId}
                  onSelect={(cible) => setChoisiId(cible.id)}
                />
              ))}
            </div>
          </AsyncBoundary>
        </Card>

        {choisi && fiche ? (
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader
                title={choisi.name}
                subtitle={`Code ${choisi.code} — non modifiable, il est cité dans les exports et le journal d’audit.`}
                icon={Building2}
                action={
                  <IconButton
                    icon={Trash2}
                    label={`Supprimer ${choisi.name}`}
                    disabled={envoi}
                    onClick={() =>
                      agir(async () => {
                        await deleteBuilding(choisi.id);
                        setChoisiId(null);
                      }, 'Bâtiment supprimé').catch(() => {})
                    }
                  />
                }
              />

              <ImageDuBatiment
                building={choisi}
                busy={envoi}
                onUpload={(fichier) =>
                  agir(() => uploadBuildingImage(choisi.id, fichier), 'Photographie déposée')
                }
                onRemove={() =>
                  agir(() => removeBuildingImage(choisi.id), 'Photographie retirée')
                }
              />

              <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
                <Input
                  label="Nom"
                  value={fiche.name ?? ''}
                  onChange={(event) => setFiche({ ...fiche, name: event.target.value })}
                />
                <Input
                  label="Adresse"
                  value={fiche.address ?? ''}
                  onChange={(event) => setFiche({ ...fiche, address: event.target.value })}
                />
              </div>

              <SaveBar
                dirty={modifie}
                saving={envoi}
                valid={Boolean(fiche.name?.trim())}
                onCancel={() => setFiche({ ...choisi })}
                onSave={() =>
                  agir(
                    () => updateBuilding(choisi.id, { name: fiche.name, address: fiche.address }),
                    'Bâtiment enregistré',
                  )
                }
              />
            </Card>

            <Card>
              <CardHeader
                title="Niveaux et salles"
                subtitle="Une salle se rattache à un étage. Cliquez une salle pour ouvrir sa fiche."
                icon={Layers}
              />
              <AsyncBoundary
                status={etages.status}
                error={etages.error}
                onRetry={etages.reload}
                skeleton={<SkeletonCard />}
              >
                <FloorAccordion
                  floors={etages.data ?? []}
                  busy={envoi}
                  onAddFloor={() => setEtageEnCours({ mode: 'creation' })}
                  onRenameFloor={(etage) => setEtageEnCours({ mode: 'edition', etage })}
                  onDeleteFloor={(etage) =>
                    agir(async () => {
                      await deleteFloor(etage.id);
                      await etages.reload();
                    }, 'Étage supprimé').catch(() => {})
                  }
                  onOpenRoom={(salle) => navigate(`/admin/salles/${salle.id}`)}
                  onOpenPlan={(etage) => setPlanOuvert(etage)}
                />
              </AsyncBoundary>
            </Card>
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={Building2}
              title="Aucun bâtiment sélectionné"
              description="Choisissez un bâtiment pour voir ses niveaux et ses salles."
            />
          </Card>
        )}
      </div>

      <ModaleBatiment
        open={creation}
        busy={envoi}
        onClose={() => setCreation(false)}
        onSubmit={async (valeurs) => {
          const cree = await agir(() => createBuilding(valeurs), 'Bâtiment créé');
          setChoisiId(cree.id);
          setCreation(false);
        }}
      />

      <FloorPlanModal
        floor={planOuvert}
        open={Boolean(planOuvert)}
        onClose={() => setPlanOuvert(null)}
        onChanged={() => etages.reload()}
      />

      <ModaleEtage
        state={etageEnCours}
        busy={envoi}
        onClose={() => setEtageEnCours(null)}
        onSubmit={async (valeurs) => {
          await agir(async () => {
            if (etageEnCours.mode === 'creation') await createFloor(choisi.id, valeurs);
            else await updateFloor(etageEnCours.etage.id, valeurs);
            await etages.reload();
          }, etageEnCours.mode === 'creation' ? 'Étage ajouté' : 'Étage enregistré');
          setEtageEnCours(null);
        }}
      />
    </div>
  );
}

/** Photographie du bâtiment : c'est elle qu'on reconnaît, pas « Eiffel 3 ». */
function ImageDuBatiment({ building, busy, onUpload, onRemove }) {
  const [erreur, setErreur] = useState(null);

  const choisir = async (event) => {
    const fichier = event.target.files?.[0];
    event.target.value = '';
    if (!fichier) return;
    setErreur(null);
    try {
      await onUpload(fichier);
    } catch (souci) {
      setErreur(souci.message ?? 'Le dépôt a échoué.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 px-4 pb-4">
      {building.imageUrl ? (
        <img
          src={building.imageUrl}
          alt={`Façade de ${building.name}`}
          className="h-28 w-44 rounded-xl border border-line object-cover"
        />
      ) : (
        <span className="flex h-28 w-44 items-center justify-center rounded-xl border border-dashed border-line">
          <ImageIcon size={20} aria-hidden="true" className="text-content-faint" />
        </span>
      )}

      <div className="min-w-0">
        <p className="text-sm text-content">Photographie du bâtiment</p>
        <p className="text-xs text-content-muted">PNG, JPEG ou WebP, jusqu’à 5 Mo.</p>
        {erreur && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {erreur}
          </p>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="cursor-pointer">
          <input
            type="file"
            accept={TYPES_IMAGE.join(',')}
            onChange={choisir}
            className="sr-only"
            aria-label="Choisir la photographie du bâtiment"
          />
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs text-content transition hover:border-line-strong">
            <Upload size={14} aria-hidden="true" />
            {building.imageUrl ? 'Remplacer' : 'Déposer'}
          </span>
        </label>
        {building.imageUrl && (
          <Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={onRemove}>
            Retirer
          </Button>
        )}
      </div>
    </div>
  );
}

function ModaleBatiment({ open, busy, onClose, onSubmit }) {
  const [valeurs, setValeurs] = useState({ code: '', name: '', address: '' });

  useEffect(() => {
    if (open) setValeurs({ code: '', name: '', address: '' });
  }, [open]);

  const complet = valeurs.code.trim().length > 0 && valeurs.name.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau bâtiment"
      description="Un bâtiment naît sans étage : les niveaux s’ajoutent ensuite."
      icon={Building2}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!complet} onClick={() => onSubmit(valeurs)}>
            Créer le bâtiment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Code"
          required
          placeholder="EIF1"
          hint="Quatre caractères au plus. Il identifie le bâtiment dans les exports, et ne pourra plus changer."
          value={valeurs.code}
          onChange={(event) => setValeurs({ ...valeurs, code: event.target.value.toUpperCase() })}
        />
        <Input
          label="Nom"
          required
          placeholder="Eiffel 1"
          value={valeurs.name}
          onChange={(event) => setValeurs({ ...valeurs, name: event.target.value })}
        />
        <Input
          label="Adresse"
          placeholder="12 rue Pasteur, 94270 Le Kremlin-Bicêtre"
          value={valeurs.address}
          onChange={(event) => setValeurs({ ...valeurs, address: event.target.value })}
        />
      </div>
    </Modal>
  );
}

function ModaleEtage({ state, busy, onClose, onSubmit }) {
  const [valeurs, setValeurs] = useState({ code: '', label: '', level: 0 });

  useEffect(() => {
    if (!state) return;
    setValeurs(
      state.mode === 'edition'
        ? { code: state.etage.code, label: state.etage.label, level: state.etage.level }
        : { code: '', label: '', level: 0 },
    );
  }, [state]);

  const complet = valeurs.code.trim().length > 0 && valeurs.label.trim().length > 0;

  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      title={state?.mode === 'edition' ? 'Modifier l’étage' : 'Ajouter un étage'}
      icon={Layers}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!complet} onClick={() => onSubmit(valeurs)}>
            {state?.mode === 'edition' ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Code"
          required
          placeholder="R2"
          hint="Court, affiché dans les listes."
          value={valeurs.code}
          onChange={(event) => setValeurs({ ...valeurs, code: event.target.value })}
        />
        <Input
          label="Libellé"
          required
          placeholder="2e étage"
          value={valeurs.label}
          onChange={(event) => setValeurs({ ...valeurs, label: event.target.value })}
        />
        <Input
          type="number"
          label="Niveau"
          required
          hint="Entier de tri : 0 pour le rez-de-chaussée, −1 pour un sous-sol. Le libellé étant du texte, il ne s’ordonne pas correctement."
          value={valeurs.level}
          onChange={(event) => setValeurs({ ...valeurs, level: event.target.value })}
        />
      </div>
    </Modal>
  );
}
