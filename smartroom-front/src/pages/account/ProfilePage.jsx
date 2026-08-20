import { useEffect, useState } from 'react';
import { Bell, Save, Shield, SlidersHorizontal, User } from 'lucide-react';
import { listBuildings } from '../../api/buildings';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../utils/cn';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  IdentitySection,
  NotificationsSection,
  PreferencesSection,
  SecuritySection,
} from '../../components/account/ProfileSections';

const SECTIONS = [
  { id: 'profil', label: 'Profil', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'securite', label: 'Sécurité', icon: Shield },
  { id: 'preferences', label: 'Préférences', icon: SlidersHorizontal },
];

/** U-21 — Profil et paramètres : informations, notifications, sécurité, préférences. */
export default function ProfilePage() {
  const { user, updateProfile, savePreferences } = useAuth();
  const toast = useToast();
  const [section, setSection] = useState('profil');
  const [profile, setProfile] = useState(user);
  const [preferences, setPreferences] = useState(user.preferences);
  const [saving, setSaving] = useState(false);

  const buildings = useAsync(listBuildings, []);

  useEffect(() => {
    document.title = 'Profil et paramètres — SmartRoom Manager';
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        phone: profile.phone,
        department: profile.department,
      });
      await savePreferences(preferences);
      toast.success('Modifications enregistrées');
    } catch (error) {
      toast.error('Enregistrement impossible', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mon profil"
        subtitle="Gérez vos informations et vos préférences de notification."
      />

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Sections du profil" className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'true' : undefined}
              onClick={() => setSection(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                section === item.id
                  ? 'border-accent/50 bg-accent-soft text-content'
                  : 'border-transparent text-content-muted hover:bg-surface-raised hover:text-content',
              )}
            >
              <item.icon size={15} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-4">
          {section === 'profil' && (
            <IdentitySection
              profile={profile}
              onChange={(patch) => setProfile((current) => ({ ...current, ...patch }))}
            />
          )}
          {section === 'notifications' && (
            <NotificationsSection
              preferences={preferences}
              onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))}
            />
          )}
          {section === 'securite' && <SecuritySection email={profile.email} />}
          {section === 'preferences' && (
            <PreferencesSection
              preferences={preferences}
              buildings={buildings.data ?? []}
              onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))}
            />
          )}

          <footer className="flex items-center justify-end gap-3 border-t border-line pt-4">
            <Button
              variant="ghost"
              onClick={() => {
                setProfile(user);
                setPreferences(user.preferences);
              }}
            >
              Annuler
            </Button>
            <Button icon={Save} loading={saving} onClick={save}>
              Enregistrer les modifications
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}
