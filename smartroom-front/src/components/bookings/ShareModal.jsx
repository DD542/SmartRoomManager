import { useEffect, useState } from 'react';
import {
  CalendarArrowDown,
  Check,
  Copy,
  ExternalLink,
  ImageDown,
  Share2,
  ShieldCheck,
} from 'lucide-react';
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
import { LOGOS } from './LogosPartage';

/**
 * Le navigateur a-t-il déjà refusé la feuille de partage ?
 *
 * Retenu par navigateur, pas par réservation : c'est un réglage de l'un, pas
 * une propriété de l'autre. Le stockage local peut être refusé lui aussi —
 * navigation privée, réglages stricts — auquel cas on retombe simplement sur
 * l'ancien comportement : le bouton reparait, et échoue.
 */
const CLE_REFUS = 'smartroom:partage-systeme-refuse';

function refusMemorise() {
  // Lu à chaque ouverture, pas une fois au chargement du module : une page
  // restée ouverte garderait sinon une réponse d'avant le premier refus.
  try {
    return localStorage.getItem(CLE_REFUS) === '1';
  } catch {
    return false;
  }
}

function memoriserLeRefus() {
  try {
    localStorage.setItem(CLE_REFUS, '1');
  } catch {
    // Sans stockage, le refus se redecouvre à chaque fois. Tant pis : il ne
    // coûte qu'un clic, et rien ne justifie de faire échouer l'écran pour ça.
  }
}

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
  //: Le navigateur a refusé la feuille de partage. Mesuré sur Brave pour
  //: ordinateur : `navigator.share` existe, et rejette `NotAllowedError`. Un
  //: bouton principal qui échoue une fois échouera toutes les suivantes — il
  //: cède alors la place à ce qui marche.
  //:
  //: Et le refus est retenu d'une fenêtre à l'autre : il tient à un réglage du
  //: navigateur, pas à l'humeur du moment. Sans cette mémoire, l'utilisateur
  //: retrouvait le bouton à chaque ouverture, cliquait, et relisait la même
  //: erreur — « j'ai encore cette erreur ».
  const [partageRefuse, setPartageRefuse] = useState(refusMemorise);

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
  //: Seule la feuille du système sait joindre des fichiers. Sans elle — ou
  //: après son refus — rien n'est joint à rien, et l'écran ne doit pas
  //: prétendre le contraire.
  const partageAutomatique = partageNatifDisponible() && !partageRefuse;

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

        // Un refus laisse l'utilisateur devant un message et rien de fait. Le
        // résumé est donc copié dans la foulée : il voulait envoyer un texte à
        // quelqu'un, il l'a, et il lui reste à choisir où le coller. Le nom de
        // l'erreur est écrit — « NotAllowedError », « NotSupportedError » — car
        // c'est la seule chose qui distingue un navigateur qui ne sait pas
        // partager d'un réglage qui l'en empêche.
        setPartageRefuse(true);
        memoriserLeRefus();
        navigator.clipboard
          ?.writeText(resume)
          .then(() =>
            setEchec(
              `Votre navigateur ne permet pas la feuille de partage du système ` +
                `(${erreur?.name ?? 'erreur inconnue'}) — c’est le cas de Brave et de ` +
                'Firefox sur ordinateur. Le résumé vient d’être copié : collez-le où ' +
                'vous voulez, ou passez par les boutons ci-dessous.',
            ),
          )
          .catch(() =>
            setEchec(
              `Votre navigateur ne permet pas la feuille de partage du système ` +
                `(${erreur?.name ?? 'erreur inconnue'}). Le résumé reste sélectionnable ` +
                'ci-dessus, et les boutons ci-dessous ouvrent l’application voulue.',
            ),
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

  /**
   * Dépose un fichier, quel qu'il soit.
   *
   * Le plan n'est joint automatiquement que par la feuille du système. Quand
   * elle manque, il reste à portée : l'utilisateur le télécharge et l'attache
   * lui-même dans la conversation. Mieux vaut cela qu'une phrase promettant
   * une pièce jointe qui n'arrivera jamais.
   */
  const deposer = (blob, nom) => {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    URL.revokeObjectURL(url);
  };

  const telechargerPlan = async () => {
    setEchec(null);
    try {
      const reponse = await fetch(booking.room.locationPlanUrl);
      if (!reponse.ok) throw new Error(String(reponse.status));
      const contenu = await reponse.blob();
      const extension = (contenu.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
      deposer(contenu, `plan-${booking.room.name}.${extension}`);
    } catch {
      // Nomme ce qui manque plutôt que de ne rien faire : le résumé porte
      // déjà le bâtiment et l'étage, le partage reste possible sans le plan.
      setEchec('Le plan de la salle n’a pas pu être récupéré. Le résumé porte déjà le bâtiment et l’étage.');
    }
  };

  const telechargerInvitation = () =>
    deposer(
      new Blob([icsPartageable(booking)], { type: 'text/calendar;charset=utf-8' }),
      'invitation.ics',
    );

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
        {/* Ce que verra la personne : le sujet de la fenêtre, donc en tête. */}
        <pre className="whitespace-pre-wrap rounded-xl border border-line bg-surface-raised px-3.5 py-3 font-sans text-sm leading-relaxed text-content">
          {resume}
        </pre>

        {echec && <Callout tone="warning">{echec}</Callout>}

        {/* Ce qui marche vient avant ce qui explique.
            
            Le message de refus disait « passez par les boutons ci-dessous » en
            désignant un bloc qui tombait hors du champ : mesuré sur une fenêtre
            de 700 px, 143 px de contenu étaient masqués et « Ouvrir dans »
            commençait 57 px sous le bas de la zone visible. L'utilisateur
            devait deviner qu'il y avait une suite — et le partage « ne passait
            pas », faute de trouver ce qui l'aurait fait passer. */}
        <div className="flex flex-col gap-2">
          {/* Retiré après un refus : le proposer encore en action principale
              enverrait l'utilisateur droit sur le même mur. */}
          {partageAutomatique && (
            <Button icon={Share2} fullWidth onClick={partagerNativement}>
              Partager…
            </Button>
          )}

          <p className="pt-1 text-xs uppercase tracking-wide text-content-muted">
            Ouvrir dans
          </p>
          {/* Une grille de deux, pas une rangée : à quatre applications, des
              cellules égales se visent mieux qu'une file de largeurs
              inégales, et le pouce en trouve deux par ligne au téléphone. */}
          <div className="grid grid-cols-2 gap-2">
            {liens.map((lien, rang) => {
              const Logo = LOGOS[lien.id];
              // En nombre impair, le dernier prend la ligne entière : une
              // cellule seule à mi-largeur ressemble à une erreur de calage.
              const seulSurSaLigne = liens.length % 2 === 1 && rang === liens.length - 1;
              return (
                <a
                  key={lien.id}
                  href={lien.href}
                  target="_blank"
                  // `noopener` : la page ouverte ne doit pas pouvoir manipuler
                  // celle-ci par `window.opener`.
                  rel="noopener noreferrer"
                  // La couleur de marque teinte le logo et la bordure au
                  // survol, jamais le fond : quatre aplats vifs dans une
                  // fenêtre sombre se disputeraient l'attention que le résumé
                  // doit garder.
                  style={{ '--marque': lien.couleur }}
                  // Facebook ne transporte qu'un lien : le résumé part au
                  // presse-papiers pour être collé dans la publication. Le
                  // lien s'ouvre dans tous les cas — un presse-papiers refusé
                  // ne doit pas empêcher le partage.
                  onClick={() => {
                    if (lien.copieLeResume) navigator.clipboard?.writeText(resume).catch(() => {});
                  }}
                  className={`group inline-flex min-h-[46px] items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3.5 text-sm font-medium text-content transition hover:border-[var(--marque)] hover:bg-surface focus-visible:border-[var(--marque)] focus-visible:outline-none ${
                    seulSurSaLigne ? 'col-span-2' : ''
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--marque)_16%,transparent)] text-[var(--marque)]"
                    aria-hidden="true"
                  >
                    {Logo ? <Logo /> : <ExternalLink size={15} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{lien.label}</span>
                  <ExternalLink
                    size={13}
                    aria-hidden="true"
                    className="shrink-0 text-content-faint transition group-hover:text-content-muted"
                  />
                </a>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-content-faint">
            Le résumé y arrive prérempli. Facebook fait exception : il ne partage
            qu’un lien — celui de la page publique de SmartRoom, la réservation
            n’en ayant aucune — et le résumé est copié pour que vous le colliez dans
            votre publication.
          </p>

          <Button
            // Devient l'action principale quand la feuille du système est
            // refusée : c'est alors le geste qui aboutit.
            variant={partageRefuse ? 'primary' : 'secondary'}
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
          {/* Proposé seulement quand rien ne joindra le plan tout seul. */}
          {booking.room?.locationPlanUrl && !partageAutomatique && (
            <Button variant="secondary" icon={ImageDown} fullWidth onClick={telechargerPlan}>
              Télécharger le plan
            </Button>
          )}
        </div>

        {booking.room?.locationPlanUrl && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised p-2">
            <img
              src={booking.room.locationPlanUrl}
              alt={`Plan de localisation — ${booking.room.name}`}
              className="h-16 w-24 shrink-0 rounded-lg object-cover"
            />
            <p className="text-xs text-content-muted">
              {partageAutomatique
                ? 'Le plan de la salle et l’invitation d’agenda sont joints au partage.'
                : 'Ce navigateur ne joint pas de fichier à un partage : téléchargez le plan et l’invitation pour les attacher vous-même.'}
            </p>
          </div>
        )}

        <Callout tone="success" icon={ShieldCheck} title="Le code d’accès n’est pas partagé">
          C’est le code d’une porte : il ouvre la salle à qui le lit, et un message se
          transfère. Le lien vers la réservation ne part pas non plus — elle n’est visible
          que par vous.
        </Callout>
      </div>
    </Modal>
  );
}
