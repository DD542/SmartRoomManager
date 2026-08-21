import { useState } from 'react';
import { MailCheck, Send, Trash2, UserPlus } from 'lucide-react';
import {
  cancelInvitation,
  inviteAdmin,
  listAdmins,
  listInvitations,
  resendInvitation,
  updateAdminPermissions,
} from '../../../api/admin/admins';
import { listPermissionGroups } from '../../../api/admin/session';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useToast } from '../../../hooks/useToast';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button, IconButton } from '../../../components/ui/Button';
import { Card, CardHeader } from '../../../components/ui/Card';
import { AsyncBoundary, EmptyState, SkeletonCard } from '../../../components/ui/States';
import { InviteModal } from '../../../components/admin/people/InviteModal';
import { PermissionMatrix } from '../../../components/admin/people/PermissionMatrix';
import { fmtDate, fmtRelative } from '../../../utils/dates';
import { fullName, plural } from '../../../utils/format';

/**
 * A-12 — Rôles et permissions.
 *
 * La matrice écrit directement dans la session des comptes concernés : une case
 * décochée retire l'entrée de menu et bloque la route, sans redéploiement.
 */
export default function RolesPage() {
  useDocumentTitle('Rôles et permissions');
  const toast = useToast();

  const [invitation, setInvitation] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const groupes = useAsync(listPermissionGroups, []);
  const comptes = useAsync(listAdmins, []);
  const invitations = useAsync(listInvitations, []);

  const basculer = async (admin, permission, accorder) => {
    setEnvoi(true);
    try {
      const futures = accorder
        ? [...admin.permissions, permission]
        : admin.permissions.filter((item) => item !== permission);
      await updateAdminPermissions(admin.id, futures);
      await comptes.reload();
    } catch (erreur) {
      toast.error('Permission inchangée', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const inviter = async (form) => {
    setEnvoi(true);
    try {
      await inviteAdmin(form);
      toast.success('Invitation envoyée', form.email);
      setInvitation(false);
      await invitations.reload();
    } catch (erreur) {
      toast.error('Invitation refusée', erreur.message);
    } finally {
      setEnvoi(false);
    }
  };

  const surInvitation = async (action, message, email) => {
    setEnvoi(true);
    try {
      await action();
      toast.success(message, email);
      await invitations.reload();
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rôles et permissions"
        subtitle="Qui peut faire quoi dans l’administration."
        actions={
          <Button icon={UserPlus} onClick={() => setInvitation(true)}>
            Inviter un administrateur
          </Button>
        }
      />

      <AsyncBoundary
        status={comptes.status}
        error={comptes.error}
        onRetry={comptes.reload}
        skeleton={<SkeletonCard />}
      >
        <Card className="overflow-hidden">
          <CardHeader
            title="Matrice des permissions"
            subtitle={`${plural(comptes.data?.length ?? 0, 'compte')} d’administration`}
          />
          <PermissionMatrix
            groups={groupes.data ?? []}
            admins={comptes.data ?? []}
            onToggle={basculer}
            busy={envoi}
          />
          <ul className="flex flex-col gap-1 border-t border-line px-4 py-3 text-[11px] text-content-faint">
            {(comptes.data ?? []).map((admin) => (
              <li key={admin.id}>
                {fullName(admin)} — {admin.role} · dernière connexion{' '}
                {fmtRelative(admin.lastLoginAt)}
              </li>
            ))}
          </ul>
        </Card>
      </AsyncBoundary>

      <Card>
        <CardHeader
          title="Invitations en attente"
          subtitle="Comptes invités qui n’ont pas encore activé leur accès"
        />
        {(invitations.data ?? []).length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState
              icon={MailCheck}
              title="Aucune invitation en attente"
              description="Tous les administrateurs invités ont activé leur compte."
            />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line px-4 pb-4">
            {invitations.data.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-content">{invite.email}</span>
                  <span className="block text-[11px] text-content-faint">
                    {plural(invite.permissions.length, 'permission')} · envoyée le{' '}
                    {fmtDate(invite.sentAt)}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Send}
                  disabled={envoi}
                  onClick={() =>
                    surInvitation(
                      () => resendInvitation(invite.id),
                      'Invitation renvoyée',
                      invite.email,
                    )
                  }
                >
                  Renvoyer
                </Button>
                <IconButton
                  icon={Trash2}
                  label={`Annuler l’invitation de ${invite.email}`}
                  disabled={envoi}
                  onClick={() =>
                    surInvitation(
                      () => cancelInvitation(invite.id),
                      'Invitation annulée',
                      invite.email,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InviteModal
        open={invitation}
        onClose={() => setInvitation(false)}
        onSubmit={inviter}
        groups={groupes.data ?? []}
        loading={envoi}
      />
    </div>
  );
}
