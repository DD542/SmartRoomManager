import { useState } from 'react';
import { KeyRound, ShieldCheck, User, Wifi } from 'lucide-react';
import {
  changePassword,
  getCurrentUser,
  listSessions,
  removeAvatar,
  revokeOtherSessions,
  updateProfile,
  uploadAvatar,
} from '../../../api/auth';
import { listPermissionGroups } from '../../../api/admin/admins';
import { useAdminSession } from '../../../hooks/useAdminSession';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Callout, Card, CardHeader } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Form';
import { AsyncBoundary, SkeletonCard } from '../../../components/ui/States';
import { SaveBar } from '../../../components/admin/SaveBar';
import { AvatarField } from '../../../components/account/AvatarField';
import { SessionList } from '../../../components/admin/account/SessionList';
import { fullName } from '../../../utils/format';

/**
 * Réglages du compte d'administration.
 *
 * L'écran vit dans l'espace admin plutôt que de renvoyer vers celui de
 * l'espace utilisateur : changer sa photo ne devrait pas obliger à quitter
 * l'outil, puis à y revenir.
 *
 * Il ne réutilise pas non plus les sections de `U-21`, qui annoncent des
 * choses fausses — que le mot de passe se change « depuis l'intranet ECE »,
 * alors que `POST /auth/change-password` existe et fonctionne — et portent
 * deux boutons sans gestionnaire. Ce qui est proposé ici correspond à ce que
 * l'API sait faire, et rien d'autre.
 */
export default function AdminProfilePage() {
  useDocumentTitle('Mon profil');
  const { admin, refresh } = useAdminSession();
  const toast = useToast();

  const profil = useAsync(() => getCurrentUser(), []);
  const sessions = useAsync((options) => listSessions(options ?? {}), []);
  const groupes = useAsync(() => listPermissionGroups(), []);

  const [brouillon, setBrouillon] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const compte = brouillon ?? profil.data;
  const modifie =
    brouillon !== null &&
    profil.data !== null &&
    CHAMPS.some((champ) => (brouillon[champ] ?? '') !== (profil.data[champ] ?? ''));

  const modifier = (patch) => setBrouillon({ ...(brouillon ?? profil.data), ...patch });

  /** Applique une écriture, rafraîchit la session, et dit ce qui s'est passé. */
  const agir = async (action, succes) => {
    setEnvoi(true);
    try {
      const resultat = await action();
      // La barre haute affiche le nom et la photo : sans ce rafraîchissement,
      // l'avatar du menu resterait sur l'ancienne image jusqu'à rechargement.
      await refresh?.();
      toast.success(succes);
      return resultat;
    } catch (erreur) {
      toast.error(erreur.message ?? 'L’enregistrement a échoué.');
      throw erreur;
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mon profil"
        subtitle="Votre identité, votre photo, votre mot de passe et vos sessions ouvertes."
      />

      <AsyncBoundary
        status={profil.status}
        error={profil.error}
        onRetry={profil.reload}
        skeleton={<SkeletonCard />}
      >
        {compte && (
          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader title="Identité" icon={User} />
                <AvatarField
                  name={fullName(compte)}
                  src={compte.avatarUrl}
                  busy={envoi}
                  onUpload={(fichier) =>
                    agir(async () => {
                      const maj = await uploadAvatar(fichier);
                      profil.setData(maj);
                      setBrouillon(null);
                      return maj;
                    }, 'Photo mise à jour')
                  }
                  onRemove={() =>
                    agir(async () => {
                      const maj = await removeAvatar();
                      profil.setData(maj);
                      setBrouillon(null);
                      return maj;
                    }, 'Photo retirée')
                  }
                />

                <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
                  <Input
                    label="Prénom"
                    value={compte.firstName ?? ''}
                    onChange={(event) => modifier({ firstName: event.target.value })}
                  />
                  <Input
                    label="Nom"
                    value={compte.lastName ?? ''}
                    onChange={(event) => modifier({ lastName: event.target.value })}
                  />
                  <Input
                    label="Téléphone"
                    value={compte.phone ?? ''}
                    onChange={(event) => modifier({ phone: event.target.value })}
                  />
                  <Input
                    label="Département"
                    value={compte.department ?? ''}
                    onChange={(event) => modifier({ department: event.target.value })}
                  />
                  <Input
                    label="Adresse e-mail"
                    value={compte.email ?? ''}
                    disabled
                    hint="Elle identifie le compte : la changer sans vérification permettrait de détourner une session."
                  />
                  <Input
                    label="Promotion"
                    value={compte.promotion ?? '—'}
                    disabled
                    hint="Renseignée par l’administration."
                  />
                </div>

                <SaveBar
                  dirty={modifie}
                  saving={envoi}
                  valid={Boolean(compte.firstName?.trim() && compte.lastName?.trim())}
                  onCancel={() => setBrouillon(null)}
                  onSave={() =>
                    agir(async () => {
                      const maj = await updateProfile(compte.id, compte);
                      profil.setData(maj);
                      setBrouillon(null);
                      return maj;
                    }, 'Profil enregistré')
                  }
                />
              </Card>

              <MotDePasse busy={envoi} onSubmit={agir} />
            </div>

            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader
                  title="Sessions ouvertes"
                  subtitle="Un accès que vous ne reconnaissez pas se ferme ici."
                  icon={Wifi}
                />
                <AsyncBoundary
                  status={sessions.status}
                  error={sessions.error}
                  onRetry={sessions.reload}
                  skeleton={<SkeletonCard />}
                >
                  <SessionList
                    sessions={sessions.data ?? []}
                    busy={envoi}
                    onRevokeOthers={() =>
                      agir(async () => {
                        const fermees = await revokeOtherSessions();
                        await sessions.reload();
                        return fermees;
                      }, 'Autres sessions fermées')
                    }
                  />
                </AsyncBoundary>
              </Card>

              <Card>
                <CardHeader
                  title="Mes droits"
                  subtitle="Ce que ce compte peut faire dans l’administration."
                  icon={ShieldCheck}
                />
                <Droits
                  groupes={groupes.data ?? []}
                  accordees={admin?.permissions ?? []}
                  proprietaire={admin?.isOwner}
                />
              </Card>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}

//: Champs que l'écran modifie. Le reste du profil est en lecture seule.
const CHAMPS = ['firstName', 'lastName', 'phone', 'department'];

/** Changement de mot de passe. Toutes les sessions tombent : c'est voulu. */
function MotDePasse({ busy, onSubmit }) {
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const discordance = confirmation.length > 0 && nouveau !== confirmation;
  const complet = actuel.length > 0 && nouveau.length >= 12 && !discordance;

  return (
    <Card>
      <CardHeader title="Mot de passe" icon={KeyRound} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <Callout tone="info">
          Changer le mot de passe ferme toutes les sessions, celle-ci comprise : c’est ce qui rend
          la mesure utile quand on soupçonne un accès qu’on ne reconnaît pas.
        </Callout>

        <Input
          label="Mot de passe actuel"
          type="password"
          autoComplete="current-password"
          value={actuel}
          onChange={(event) => setActuel(event.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            value={nouveau}
            onChange={(event) => setNouveau(event.target.value)}
            hint="Douze caractères au minimum."
          />
          <Input
            label="Confirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            error={discordance ? 'Les deux saisies diffèrent.' : undefined}
          />
        </div>

        <Button
          variant="secondary"
          icon={KeyRound}
          loading={busy}
          disabled={!complet}
          className="w-fit"
          onClick={() =>
            onSubmit(async () => {
              await changePassword({ currentPassword: actuel, newPassword: nouveau });
              setActuel('');
              setNouveau('');
              setConfirmation('');
            }, 'Mot de passe changé — reconnectez-vous')
          }
        >
          Changer le mot de passe
        </Button>
      </div>
    </Card>
  );
}

/** Droits du compte, en lecture seule : ils s'accordent depuis A-14. */
function Droits({ groupes, accordees, proprietaire }) {
  if (proprietaire) {
    return (
      <div className="px-4 pb-4">
        <Callout tone="accent" title="Propriétaire">
          Ce compte détient tous les droits, sans dépendre de la matrice. Les lui retirer fermerait
          la configuration du système pour tout le monde.
        </Callout>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {groupes.map((groupe) => {
        const siennes = groupe.permissions.filter((item) => accordees.includes(item.code));
        if (siennes.length === 0) return null;
        return (
          <div key={groupe.id}>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-content-faint">
              {groupe.label}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {siennes.map((item) => (
                <li key={item.code}>
                  <Badge tone="accent">{item.label}</Badge>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {accordees.length === 0 && (
        <p className="text-xs text-content-faint">
          Aucun droit accordé : ce compte peut se connecter, sans plus.
        </p>
      )}
    </div>
  );
}
