import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  Check,
  KeyRound,
  LifeBuoy,
  MapPin,
  ScrollText,
  X,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/**
 * Cartes riches de l'assistant.
 *
 * Une carte par sorte de résultat, et un aiguillage unique : le serveur nomme
 * la carte, l'écran la rend. Ajouter une sorte revient donc à ajouter un cas
 * ici, sans toucher au panneau ni au flux.
 *
 * Les données affichées sont celles que l'outil a rendues, telles quelles.
 * Rien n'est recalculé côté écran : un score réaffiché autrement que ce que le
 * moteur a produit ferait douter des deux.
 */

function Enveloppe({ children }) {
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface p-3">{children}</div>
  );
}

function CarteSalles({ donnees }) {
  const salles = donnees?.propositions ?? donnees?.salles ?? [];
  if (!salles.length) return null;

  return (
    <Enveloppe>
      {salles.slice(0, 3).map((salle) => (
        <Link
          key={salle.salle_id}
          to={`/app/salles/${salle.salle_id}`}
          className="block rounded-lg border border-line bg-surface-raised p-2.5 transition hover:border-accent/50"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-content">{salle.nom}</span>
            {salle.score != null && <Badge tone="accent">{salle.score} / 100</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-content-muted">
            {salle.capacite} places • {salle.batiment} • {salle.etage}
          </span>
          {salle.justification && (
            <span className="mt-1 block text-xs text-content-muted">{salle.justification}</span>
          )}
        </Link>
      ))}
    </Enveloppe>
  );
}

function CarteCreneaux({ donnees }) {
  const creneaux = donnees?.creneaux_libres_ce_jour ?? [];
  const heure = (valeur) =>
    new Date(valeur).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        {donnees?.disponible ? (
          <Check size={15} className="text-success" aria-hidden="true" />
        ) : (
          <X size={15} className="text-danger" aria-hidden="true" />
        )}
        {donnees?.salle?.nom} — {donnees?.disponible ? 'libre' : 'occupée'}
      </p>
      {(donnees?.empechements ?? []).map((item) => (
        <p key={item.detail} className="text-xs text-content-muted">
          {item.detail}
        </p>
      ))}
      {creneaux.length > 0 && (
        <p className="text-xs text-content-muted">
          Libre ce jour-là :{' '}
          {creneaux.map((item) => `${heure(item.debut)}–${heure(item.fin)}`).join(', ')}
        </p>
      )}
    </Enveloppe>
  );
}

function CarteReservations({ donnees }) {
  const reservations = donnees?.reservations ?? [];
  if (!reservations.length) return null;

  return (
    <Enveloppe>
      {reservations.slice(0, 4).map((item) => (
        <Link
          key={item.reservation_id}
          to={`/app/reservations/${item.reservation_id}`}
          className="block rounded-lg border border-line bg-surface-raised p-2.5 transition hover:border-accent/50"
        >
          <span className="block text-sm text-content">{item.objet}</span>
          <span className="mt-0.5 block text-xs text-content-muted">
            {item.salle} • {new Date(item.debut).toLocaleString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </Link>
      ))}
    </Enveloppe>
  );
}

function CarteReservation({ donnees }) {
  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        <CalendarCheck size={15} className="text-success" aria-hidden="true" />
        {donnees?.objet} — {donnees?.salle}
      </p>
      <p className="text-xs text-content-muted">
        {new Date(donnees?.debut).toLocaleString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
      {donnees?.code_acces && (
        // Seul instant où le code existe en clair : il n'est pas conservé, et
        // l'écran le dit plutôt que de laisser croire qu'on pourra le relire.
        <p className="rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-2 font-mono text-sm text-content">
          Code d’accès : {donnees.code_acces}
          <span className="mt-0.5 block font-sans text-xs text-content-muted">
            Notez-le : il n’est affiché qu’une fois.
          </span>
        </p>
      )}
      {donnees?.reservation_id && (
        <Link
          to={`/app/reservations/${donnees.reservation_id}`}
          className="block text-xs text-accent hover:underline"
        >
          Ouvrir la réservation
        </Link>
      )}
    </Enveloppe>
  );
}

function CarteCodeAcces({ donnees }) {
  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        <KeyRound size={15} className="text-accent" aria-hidden="true" />
        {donnees?.salle}
      </p>
      <p className="font-mono text-sm text-content">{donnees?.indice ?? '— expiré —'}</p>
      <p className="text-xs text-content-muted">
        Valable jusqu’au{' '}
        {new Date(donnees?.valide_jusqu_a).toLocaleString('fr-FR', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </Enveloppe>
  );
}

function CartePlan({ donnees }) {
  const salle = donnees?.salle ?? {};
  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        <MapPin size={15} className="text-accent" aria-hidden="true" />
        {salle.nom} — {salle.batiment}, {salle.etage}
      </p>
      <p className="text-xs text-content-muted">{salle.adresse}</p>
      {donnees?.plan_localisation_url && (
        <img
          src={donnees.plan_localisation_url}
          alt={`Plan de localisation de ${salle.nom}`}
          className="w-full rounded-lg border border-line"
        />
      )}
    </Enveloppe>
  );
}

function CarteRegles({ donnees }) {
  const regles = donnees?.regles;
  if (!regles) return null;

  const lignes = [
    ['Durée', `${regles.duree_min_minutes} à ${regles.duree_max_minutes} min`],
    ['Préavis', `${regles.preavis_min_minutes} min`],
    ['Annulation', `jusqu’à ${regles.delai_annulation_minutes} min avant`],
    ['Horizon', `${regles.horizon_jours} jours`],
    ['Réservations actives', `${regles.reservations_actives_max} au plus`],
  ];

  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        <ScrollText size={15} className="text-accent" aria-hidden="true" />
        {donnees.perimetre}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {lignes.map(([terme, valeur]) => (
          <div key={terme} className="contents">
            <dt className="text-content-muted">{terme}</dt>
            <dd className="text-content">{valeur}</dd>
          </div>
        ))}
      </dl>
    </Enveloppe>
  );
}

function CarteArticle({ donnees }) {
  const extraits = donnees?.extraits ?? donnees?.articles ?? [];
  if (!extraits.length) return null;

  return (
    <Enveloppe>
      {extraits.slice(0, 2).map((extrait) => (
        <Link
          key={extrait.slug}
          to={`/app/aide?article=${extrait.slug}`}
          className="block rounded-lg border border-line bg-surface-raised p-2.5 transition hover:border-accent/50"
        >
          <span className="flex items-center gap-2 text-sm text-content">
            <BookOpen size={14} className="text-accent" aria-hidden="true" />
            {extrait.titre}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-content-muted">
            {(extrait.contenu ?? extrait.extrait ?? '').slice(0, 180)}…
          </span>
        </Link>
      ))}
    </Enveloppe>
  );
}

function CarteTicket({ donnees }) {
  return (
    <Enveloppe>
      <p className="flex items-center gap-2 text-sm text-content">
        <LifeBuoy size={15} className="text-accent" aria-hidden="true" />
        Ticket {donnees?.reference}
      </p>
      <p className="text-xs text-content-muted">{donnees?.sujet}</p>
    </Enveloppe>
  );
}

/**
 * Demande de confirmation avant écriture.
 *
 * Le bouton n'envoie que le jeton : le serveur détient le brouillon validé, et
 * c'est lui qu'il exécute. Rien de ce qui est affiché ici ne repart en
 * paramètre — un écran modifié ne peut donc pas changer ce qui sera écrit.
 */
function CarteConfirmation({ donnees, onConfirmer, onAbandonner, occupe }) {
  const apercu = donnees?.apercu ?? {};
  const salle = apercu.salle?.nom ?? apercu.salle ?? null;

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-warning/40 bg-warning-soft p-3">
      <p className="flex items-start gap-2 text-sm text-content">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        {donnees?.message}
      </p>
      {salle && (
        <p className="text-xs text-content-muted">
          {salle}
          {apercu.debut && (
            <>
              {' • '}
              {new Date(apercu.debut).toLocaleString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </p>
      )}
      {donnees?.jeton && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onConfirmer(donnees.jeton)} loading={occupe}>
            Confirmer
          </Button>
          <Button size="sm" variant="ghost" onClick={onAbandonner} disabled={occupe}>
            Annuler
          </Button>
        </div>
      )}
    </div>
  );
}

const CARTES = {
  salles: CarteSalles,
  creneaux: CarteCreneaux,
  reservations: CarteReservations,
  reservation: CarteReservation,
  code_acces: CarteCodeAcces,
  plan: CartePlan,
  regles: CarteRegles,
  article: CarteArticle,
  ticket: CarteTicket,
  transfert: CarteTicket,
};

export function CarteAssistant({ sorte, donnees, onConfirmer, onAbandonner, occupe }) {
  if (!sorte || !donnees) return null;

  if (sorte === 'confirmation') {
    return (
      <CarteConfirmation
        donnees={donnees}
        onConfirmer={onConfirmer}
        onAbandonner={onAbandonner}
        occupe={occupe}
      />
    );
  }

  const Composant = CARTES[sorte];
  // Une sorte inconnue n'affiche rien plutôt que de casser le fil : le serveur
  // peut en introduire une avant que l'écran ne sache la rendre.
  return Composant ? <Composant donnees={donnees} /> : null;
}
