import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox, Input } from '../../ui/Form';
import { Callout } from '../../ui/Card';

/**
 * A-12 — invitation d'un administrateur.
 *
 * Les permissions sont choisies dès l'invitation : le compte arrive avec son
 * périmètre, plutôt qu'avec un accès vide à compléter après coup.
 */
export function InviteModal({ open, onClose, onSubmit, groups = [], loading = false }) {
  const [email, setEmail] = useState('');
  const [permissions, setPermissions] = useState([]);

  useEffect(() => {
    if (open) {
      setEmail('');
      setPermissions([]);
    }
  }, [open]);

  const basculer = (id) =>
    setPermissions((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserPlus}
      tone="accent"
      title="Inviter un administrateur"
      description="Un e-mail d’activation est envoyé à l’adresse indiquée."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={loading}
            disabled={!emailValide || permissions.length === 0}
            onClick={() => onSubmit({ email, permissions })}
          >
            Envoyer l’invitation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          type="email"
          label="Adresse email"
          required
          placeholder="prenom.nom@ece.fr"
          value={email}
          error={email && !emailValide ? 'Adresse e-mail invalide.' : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />

        {groups.map((groupe) => (
          <fieldset key={groupe.id}>
            <legend className="mb-2 text-xs uppercase tracking-wide text-content-muted">
              {groupe.label}
            </legend>
            <div className="flex flex-col gap-2">
              {groupe.permissions.map((permission) => (
                <Checkbox
                  key={permission.id}
                  label={permission.label}
                  checked={permissions.includes(permission.id)}
                  onChange={() => basculer(permission.id)}
                />
              ))}
            </div>
          </fieldset>
        ))}

        {permissions.length === 0 && (
          <Callout tone="warning">
            Un administrateur sans aucune permission ne verrait qu’un tableau de bord vide :
            sélectionnez au moins un périmètre.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
