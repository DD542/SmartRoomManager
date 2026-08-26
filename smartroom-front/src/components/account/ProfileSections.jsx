import { BadgeCheck, Bell, Shield, SlidersHorizontal, User } from 'lucide-react';
import { AvatarField } from './AvatarField';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader, Callout } from '../ui/Card';
import { Input, Select, Switch } from '../ui/Form';
import { SegmentedControl } from '../ui/Tabs';

const DELAYS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
];

/** U-21, section 1 — identité et badge d'accès. */
export function IdentitySection({
  profile,
  onChange,
  onUploadAvatar,
  onRemoveAvatar,
  photoEnCours = false,
}) {
  const field = (key) => (event) => onChange({ [key]: event.target.value });

  return (
    <>
      <Card>
        {/* Le bouton « Modifier la photo » n'avait aucun gestionnaire : ni
            colonne en base, ni route de dépôt. Il vient d'en obtenir, et le
            champ est le même que celui de l'espace d'administration. */}
        <AvatarField
          name={`${profile.firstName} ${profile.lastName}`}
          src={profile.avatarUrl}
          busy={photoEnCours}
          onUpload={onUploadAvatar}
          onRemove={onRemoveAvatar}
        />
      </Card>

      <Card>
        <CardHeader title="Informations personnelles" icon={User} />
        <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
          <Input label="Prénom" value={profile.firstName} onChange={field('firstName')} />
          <Input label="Nom" value={profile.lastName} onChange={field('lastName')} />
          <Input label="E-mail" type="email" value={profile.email} onChange={field('email')} />
          <Input label="Téléphone" value={profile.phone} onChange={field('phone')} />
          <Input label="Promotion" value={profile.promotion} disabled />
          <Input label="Département" value={profile.department} onChange={field('department')} />
        </div>
      </Card>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <BadgeCheck size={18} aria-hidden="true" className="text-success" />
        <div>
          <p className="text-sm text-content">Badge d’accès</p>
          <p className="text-xs text-content-muted">Statut : actif</p>
        </div>
        <Badge tone="default" className="ml-auto font-mono">
          N° {profile.badgeNumber}
        </Badge>
      </Card>
    </>
  );
}

/** U-21, section 2 — notifications. */
export function NotificationsSection({ preferences, onChange }) {
  return (
    <Card>
      <CardHeader title="Paramètres de notification" icon={Bell} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <Switch
          label="Confirmation par e-mail"
          description="Recevez un e-mail lors d’une nouvelle réservation."
          checked={preferences.emailConfirmation}
          onChange={(checked) => onChange({ emailConfirmation: checked })}
        />
        <div className="h-px bg-line" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-content">Délai de rappel</p>
            <p className="text-xs text-content-muted">Avant le début d’une réunion.</p>
          </div>
          <SegmentedControl
            label="Délai de rappel"
            options={DELAYS}
            value={preferences.reminderDelayMin}
            onChange={(value) => onChange({ reminderDelayMin: value })}
          />
        </div>
        <div className="h-px bg-line" aria-hidden="true" />
        <Switch
          label="Alertes dans l’application"
          description="Afficher les notifications push."
          checked={preferences.inAppAlerts}
          onChange={(checked) => onChange({ inAppAlerts: checked })}
        />
      </div>
    </Card>
  );
}

/** U-21, section 3 — sécurité du compte. */
export function SecuritySection({ email, sessions = [], onRevokeOthers, busy = false }) {
  const autres = sessions.filter((item) => !item.current).length;

  return (
    <Card>
      <CardHeader title="Sécurité du compte" icon={Shield} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* Cet encart annonçait que « le mot de passe se change depuis
            l'intranet ECE ». C'était faux : `POST /auth/change-password`
            existe et fonctionne, et la phrase masquait une fonction
            disponible. Le bouton juste en dessous, lui, n'avait aucun
            gestionnaire. */}
        <Callout tone="info">
          Changer le mot de passe ferme toutes les sessions, celle-ci comprise. Il se change depuis
          l’écran de connexion, par « mot de passe oublié ».
        </Callout>
        <Input
          label="Adresse de récupération"
          value={email}
          disabled
          hint="C’est à cette adresse qu’est envoyé le lien de réinitialisation."
        />
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          loading={busy}
          disabled={autres === 0}
          onClick={onRevokeOthers}
        >
          {autres === 0
            ? 'Aucun autre appareil connecté'
            : `Déconnecter les ${autres} autre${autres > 1 ? 's' : ''} appareil${autres > 1 ? 's' : ''}`}
        </Button>
      </div>
    </Card>
  );
}

/** U-21, section 4 — préférences de réservation. */
export function PreferencesSection({ preferences, buildings = [], onChange }) {
  return (
    <Card>
      <CardHeader title="Préférences de réservation" icon={SlidersHorizontal} />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
        <Select
          label="Bâtiment principal"
          value={preferences.preferredBuildingId}
          onChange={(event) => onChange({ preferredBuildingId: event.target.value })}
          options={buildings.map((building) => ({ value: building.id, label: building.name }))}
        />
        <Select
          label="Capacité habituelle"
          value={preferences.usualCapacity}
          onChange={(event) => onChange({ usualCapacity: event.target.value })}
          options={[
            { value: '2-4', label: '2-4 personnes' },
            { value: '5-10', label: '5-10 personnes' },
            { value: '10+', label: '10+ personnes' },
          ]}
        />
      </div>
    </Card>
  );
}
