import { useEffect, useState } from 'react';
import { CalendarArrowDown, Check, Copy, Share2, ShieldCheck } from 'lucide-react';
import {
  fichiersDePartage,
  icsPartageable,
  liensDePartage,
  partageNatifDisponible,
  resumePartage,
} from '../../utils/partage';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Card';
import { Modal } from '../ui/Modal';

/**
 * Partage d'une réservation.
 *
 * Trois voies, dans cet ordre d'utilité.
 *
 * 1. La feuille de partage du système — `navigator.share`. C'est la seule qui
 *    atteint *toutes* les applications installées, et la seule qui sache
 *    joindre des fichiers : l'invitation d'agenda et le plan de la salle
 *    partent avec le texte.
 * 2. Le presse-papiers, quand cette feuille n'existe pas (tous les navigateurs
 *    de bureau, aujourd'hui encore).
 * 3. Trois adresses de partage, pour aller directement dans la bonne
 *    application.
 *
 * Ce qui ne part jamais est écrit à l'écran, pas seulement dans le code : le
 * code d'accès. Le dire est la moitié du travail — l'utilisateur qui partage
 * doit savoir ce qu'il ne partage pas.
 */
export function ShareModal({ booking, open, onClose }) {
  const [copie, setCopie] = useState(false);
  const [echec, setEchec] = useState(null);
  //: Préparés à l'ouverture, pas au clic. Voir `partagerNativement`.
  const [fichiers, setFichiers] = useState([]);

  useEffect(() => {
    if (!open || !booking) return undefined;

    let vivant = true;
    fichiersDePartage(booking).then((liste) => {
      if (vivant) setFichiers(liste);
    });
    return () => {
      vivant = false;
    };
  }, [open, booking]);

  if (!booking) return null;

  const resume = resumePartage(booking);
  const liens = liensDePartage(booking);

  /**
   * Ouvre la feuille de partage du système.
   *
   * **Aucune attente avant l'appel.** `share()` exige une activation par un
   * geste, et cette activation ne survit pas à un `await` : la version
   * précédente préparait les pièces jointes — dont une requête réseau pour le
   * plan — puis appelait `share()`, qui refusait avec `NotAllowedError`. Le
   * partage échouait donc systématiquement, et l'écran répondait « Le partage
   * n'a pas abouti » sans autre explication.
   *
   * Les fichiers sont préparés à l'ouverture de la fenêtre ; s'ils ne sont pas
   * encore prêts, le texte part seul plutôt que rien.
   */
  const partagerNativement = () => {
    setEchec(null);
    const charge = { title: booking.title || 'Réservation', text: resume };
    // `canShare` avant `share` : un navigateur qui accepte le texte mais
    // refuse les fichiers rejetterait l'appel entier.
    const avecFichiers = fichiers.length > 0 && navigator.canShare?.({ files: fichiers });

    Promise.resolve(navigator.share(avecFichiers ? { ...charge, files: fichiers } : charge))
      .then(() => onClose())
      .catch((erreur) => {
        // Fermer la feuille de partage n'est pas un échec : c'est un choix.
        if (erreur?.name === 'AbortError') return;
        setEchec(
          'Votre navigateur a refusé le partage. Le résumé reste copiable ci-dessous, ' +
            'et les trois boutons du bas ouvrent l’application voulue.',
        );
      });
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(resume);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      setEchec('Le presse-papiers est refusé par le navigateur. Sélectionnez le texte ci-dessus.');
    }
  };

  const telechargerInvitation = () => {
    const blob = new Blob([icsPartageable(booking)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = 'invitation.ics';
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Share2}
      title="Partager cette réservation"
      description="Ce que verra la personne à qui vous l’envoyez."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <pre className="whitespace-pre-wrap rounded-xl border border-line bg-surface-raised px-3.5 py-3 font-sans text-sm leading-relaxed text-content">
          {resume}
        </pre>

        {booking.room?.locationPlanUrl && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised p-2">
            <img
              src={booking.room.locationPlanUrl}
              alt={`Plan de localisation — ${booking.room.name}`}
              className="h-16 w-24 shrink-0 rounded-lg object-cover"
            />
            <p className="text-xs text-content-muted">
              Le plan de la salle et l’invitation d’agenda sont joints au partage.
            </p>
          </div>
        )}

        <Callout tone="success" icon={ShieldCheck} title="Le code d’accès n’est pas partagé">
          C’est le code d’une porte : il ouvre la salle à qui le lit, et un message se
          transfère. Le lien vers la réservation ne part pas non plus — elle n’est visible
          que par vous.
        </Callout>

        {echec && <Callout tone="warning">{echec}</Callout>}

        <div className="flex flex-col gap-2">
          {partageNatifDisponible() && (
            <Button icon={Share2} fullWidth onClick={partagerNativement}>
              Partager…
            </Button>
          )}
          <Button
            variant="secondary"
            icon={copie ? Check : Copy}
            fullWidth
            onClick={copier}
          >
            {copie ? 'Résumé copié' : 'Copier le résumé'}
          </Button>
          <Button
            variant="secondary"
            icon={CalendarArrowDown}
            fullWidth
            onClick={telechargerInvitation}
          >
            Télécharger l’invitation (.ics)
          </Button>
        </div>

        <div>
          <p className="pb-2 text-xs uppercase tracking-wide text-content-muted">
            Ouvrir dans
          </p>
          <div className="flex flex-wrap gap-2">
            {liens.map((lien) => (
              <a
                key={lien.id}
                href={lien.href}
                target="_blank"
                // `noopener` : la page ouverte ne doit pas pouvoir manipuler
                // celle-ci par `window.opener`.
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-line bg-surface-raised px-4 text-sm text-content transition hover:border-line-strong"
              >
                {lien.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
