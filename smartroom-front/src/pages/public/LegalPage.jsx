import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';

/**
 * P-05 — Mentions légales et traitement des données.
 *
 * Le lien existait dans deux pieds de page et ne menait nulle part : l'un
 * pointait sur la racine, l'autre n'était même pas cliquable. Un lien qui ne
 * mène nulle part est pire qu'un lien absent — il annonce une information et
 * ne la donne pas.
 *
 * Le contenu décrit ce que l'application fait **réellement** : les données
 * qu'elle garde, celles qu'elle refuse de garder, et où elles vont. Rien n'y
 * est recopié d'un modèle. Une mention légale qui décrit un autre logiciel ne
 * protège personne.
 */
function Section({ titre, children }) {
  return (
    <section className="border-t border-line px-5 py-5 first:border-0">
      <h2 className="text-sm font-semibold text-content">{titre}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-content-muted">
        {children}
      </div>
    </section>
  );
}

export default function LegalPage() {
  useEffect(() => {
    document.title = 'Mentions légales — SmartRoom Manager';
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
        Mentions légales
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-content-muted">
        Ce document décrit qui édite SmartRoom Manager, ce que l’application conserve, et ce
        qu’elle ne conserve pas. Il décrit le logiciel tel qu’il est écrit, pas un modèle
        recopié.
      </p>

      <Card className="mt-8">
        <Section titre="Éditeur">
          <p>
            SmartRoom Manager est un <strong className="text-content">projet académique</strong>{' '}
            réalisé dans le cadre du Bachelor 3 Data &amp; IA de l’ECE Paris. Il
            n’est pas exploité commercialement et ne constitue pas un service ouvert au public.
          </p>
          <p>
            Responsable du traitement : l’étudiant auteur du projet, joignable par l’adresse de
            contact communiquée à l’établissement.
          </p>
        </Section>

        <Section titre="Hébergement">
          <p>
            En l’état, l’application s’exécute sur un poste de développement ou sur un serveur
            choisi par l’établissement. Aucune donnée n’est confiée à un hébergeur tiers en
            dehors des services nommés ci-dessous.
          </p>
        </Section>

        <Section titre="Données conservées">
          <p>Le strict nécessaire au fonctionnement d’un service de réservation :</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong className="text-content">Identité</strong> — nom, prénom, adresse
              électronique, et la photo de profil si vous en déposez une ou si votre compte
              Google en fournit une.
            </li>
            <li>
              <strong className="text-content">Réservations</strong> — salle, créneau, objet de
              la réunion, participants invités, présence constatée.
            </li>
            <li>
              <strong className="text-content">Sessions</strong> — date de dernière connexion,
              adresse IP et navigateur des sessions ouvertes, pour vous permettre de les
              révoquer.
            </li>
            <li>
              <strong className="text-content">Journal d’administration</strong> — les décisions
              prises par les administrateurs, qui les a prises et quand. C’est ce qui rend
              l’arbitrage d’un conflit opposable.
            </li>
          </ul>
        </Section>

        <Section titre="Ce qui n’est jamais conservé">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong className="text-content">Votre mot de passe.</strong> Seule une empreinte
              bcrypt est enregistrée ; elle ne permet pas de le retrouver.
            </li>
            <li>
              <strong className="text-content">Les codes d’accès aux salles en clair.</strong> Le
              code complet n’existe qu’à l’instant de son émission. Ensuite, seul son début est
              conservé — « E-**** ».
            </li>
            <li>
              <strong className="text-content">Aucun jeton ni code dans les journaux
              techniques.</strong> Ils sont lus par plus de monde que la base et conservés plus
              longtemps.
            </li>
          </ul>
        </Section>

        <Section titre="Connexion par compte Google">
          <p>
            Si vous choisissez cette voie, votre mot de passe est saisi{' '}
            <strong className="text-content">chez Google</strong>, jamais dans cette application.
            Google nous transmet un jeton signé qui atteste de votre adresse, de votre nom et de
            votre photo de profil. Rien d’autre n’est demandé : ni vos contacts, ni votre agenda,
            ni vos messages.
          </p>
          <p>
            Un compte créé par cette voie n’a pas de mot de passe utilisable dans SmartRoom. Vous
            pouvez en obtenir un par « mot de passe oublié » si vous souhaitez aussi cette
            seconde entrée.
          </p>
        </Section>

        <Section titre="Courriels">
          <p>
            L’application vous écrit à la confirmation d’une réservation, à son annulation, avant
            le début d’une réunion, et lorsque quelqu’un vous invite. Les invitations partent aux
            adresses que l’organisateur saisit lui-même.
          </p>
          <p>
            Les messages transitent par le relais de courrier configuré par l’établissement.
            Aucune adresse n’est communiquée à un tiers à des fins de prospection.
          </p>
        </Section>

        <Section titre="Cookies">
          <p>
            Un seul cookie, technique et strictement nécessaire : celui qui garde votre session
            ouverte. Il est <code className="font-mono text-xs text-content">httpOnly</code>,
            donc hors de portée du JavaScript, et disparaît à la déconnexion. Aucun cookie de
            mesure d’audience, aucun traceur publicitaire.
          </p>
        </Section>

        <Section titre="Vos droits">
          <p>
            Conformément au règlement général sur la protection des données, vous pouvez demander
            l’accès à vos données, leur rectification, leur effacement, ou vous opposer à leur
            traitement. La fiche de profil permet déjà de corriger vos informations et de révoquer
            vos sessions.
          </p>
          <p>
            Pour toute autre demande, écrivez à l’administration de l’application depuis{' '}
            <Link to="/app/aide" className="text-accent transition hover:text-accent-hover">
              le centre d’aide
            </Link>
            . Une réclamation peut être adressée à la CNIL.
          </p>
        </Section>

        <Section titre="Propriété intellectuelle">
          <p>
            Le code et les visuels de l’application sont l’œuvre de son auteur, dans un cadre
            pédagogique. Les marques et logos de tiers cités — Google notamment — appartiennent à
            leurs propriétaires respectifs.
          </p>
        </Section>
      </Card>

      <p className="mt-6 text-xs text-content-faint">
        Dernière mise à jour : septembre 2026.
      </p>
    </div>
  );
}
