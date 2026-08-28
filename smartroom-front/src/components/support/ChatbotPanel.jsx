import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Minus, Send, Square, X } from 'lucide-react';
import { confirmer, demander, relireConversation } from '../../api/assistant';
import { isCancelled } from '../../api/client';
import { IconButton } from '../ui/Button';
import { CarteAssistant } from './ChatCards';

/**
 * U-23 — Assistant conversationnel, monté dans AppLayout.
 *
 * Le panneau lit un flux d'événements plutôt qu'une réponse complète : le
 * texte s'affiche au fil de sa production, et l'activité des outils est
 * montrée pendant qu'elle a lieu. C'est ce qui distingue une attente de trois
 * secondes d'un écran figé de trois secondes.
 *
 * L'identifiant de conversation est conservé dans le stockage de session : au
 * rechargement de la page, le fil reprend là où il s'était arrêté. Le stockage
 * de session et non local — une conversation n'a pas à survivre à la fermeture
 * de l'onglet, et son contenu reste côté serveur de toute façon.
 */

const CLE_SESSION = 'smartroom.assistant.conversation';

const SUGGESTIONS = [
  'Trouver une salle pour 4 personnes',
  'Comment annuler une réservation ?',
  'Où se trouve la salle Hopper ?',
];

let compteur = 0;
const identifiant = () => `msg-${(compteur += 1)}`;

function lireSession() {
  try {
    return window.sessionStorage.getItem(CLE_SESSION);
  } catch {
    // Navigation privée, stockage refusé : la conversation démarre à neuf.
    return null;
  }
}

function ecrireSession(valeur) {
  try {
    if (valeur) window.sessionStorage.setItem(CLE_SESSION, valeur);
    else window.sessionStorage.removeItem(CLE_SESSION);
  } catch {
    /* sans effet : la reprise est un confort, pas une fonction */
  }
}

export function ChatbotPanel() {
  const [ouvert, setOuvert] = useState(false);
  const [messages, setMessages] = useState([]);
  const [saisie, setSaisie] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [activite, setActivite] = useState(null);
  const [suggestions, setSuggestions] = useState(SUGGESTIONS);
  const [conversationId, setConversationId] = useState(lireSession);

  const liste = useRef(null);
  const controleur = useRef(null);

  useEffect(() => {
    liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: 'smooth' });
  }, [messages, activite]);

  // Reprise après rechargement : le fil est relu depuis le serveur, qui en est
  // la seule source. Un fil reconstitué depuis le navigateur divergerait de ce
  // que l'administration voit.
  useEffect(() => {
    if (!ouvert || !conversationId || messages.length > 0) return;

    let vivant = true;
    relireConversation(conversationId)
      .then((fil) => {
        if (!vivant) return;
        setMessages(
          fil.messages.map((message) => ({
            id: message.id,
            de: message.role === 'utilisateur' ? 'moi' : 'bot',
            texte: message.texte,
            carte: message.carte,
            donnees: message.donnees,
            sources: message.sources,
          })),
        );
      })
      .catch(() => {
        // Conversation supprimée ou expirée : on repart à neuf plutôt que de
        // laisser un identifiant mort empêcher toute nouvelle question.
        ecrireSession(null);
        setConversationId(null);
      });

    return () => {
      vivant = false;
    };
  }, [ouvert, conversationId, messages.length]);

  const consommer = useCallback(
    async (flux) => {
      const idReponse = identifiant();
      let texte = '';
      let carte = null;
      let donnees = null;
      let sources = [];
      let reserve = null;

      setMessages((courant) => [...courant, { id: idReponse, de: 'bot', texte: '' }]);

      const rafraichir = () =>
        setMessages((courant) =>
          courant.map((message) =>
            message.id === idReponse
              ? { ...message, texte, carte, donnees, sources, reserve }
              : message,
          ),
        );

      for await (const evenement of flux) {
        switch (evenement.type) {
          case 'conversation':
            setConversationId(evenement.conversation_id);
            ecrireSession(evenement.conversation_id);
            break;
          case 'texte':
            texte += evenement.texte;
            rafraichir();
            break;
          case 'outil':
            setActivite(evenement.etat === 'fini' ? null : evenement.libelle);
            break;
          case 'carte':
          case 'confirmation':
            carte = evenement.type === 'confirmation' ? 'confirmation' : evenement.carte;
            donnees = evenement.type === 'confirmation' ? evenement : evenement.donnees;
            rafraichir();
            break;
          case 'sources':
            sources = evenement.sources ?? [];
            rafraichir();
            break;
          case 'reserve':
            reserve = evenement.message;
            rafraichir();
            break;
          case 'suggestions':
            setSuggestions(evenement.suggestions ?? SUGGESTIONS);
            break;
          case 'erreur':
            texte = texte || evenement.message;
            rafraichir();
            break;
          case 'fin':
            setActivite(null);
            break;
          default:
            break;
        }
      }

      // Un tour qui n'a produit ni texte ni carte laisserait une bulle vide.
      setMessages((courant) =>
        courant.filter((message) => message.id !== idReponse || message.texte || message.carte),
      );
    },
    [],
  );

  const envoyer = async (contenu) => {
    const texte = (contenu ?? saisie).trim();
    if (!texte || enCours) return;

    setMessages((courant) => [...courant, { id: identifiant(), de: 'moi', texte }]);
    setSaisie('');
    setEnCours(true);
    setActivite('Réflexion');

    controleur.current = new AbortController();
    try {
      await consommer(demander(texte, { conversationId, signal: controleur.current.signal }));
    } catch (souci) {
      if (!isCancelled(souci) && souci.name !== 'AbortError') {
        setMessages((courant) => [
          ...courant,
          { id: identifiant(), de: 'bot', texte: souci.message },
        ]);
      }
    } finally {
      setEnCours(false);
      setActivite(null);
      controleur.current = null;
    }
  };

  const valider = async (jeton) => {
    if (enCours) return;
    setEnCours(true);
    controleur.current = new AbortController();
    try {
      await consommer(confirmer(jeton, { conversationId, signal: controleur.current.signal }));
    } catch (souci) {
      if (!isCancelled(souci) && souci.name !== 'AbortError') {
        setMessages((courant) => [
          ...courant,
          { id: identifiant(), de: 'bot', texte: souci.message },
        ]);
      }
    } finally {
      setEnCours(false);
      controleur.current = null;
    }
  };

  /** Retire la carte de confirmation : le brouillon expirera de lui-même. */
  const abandonner = (idMessage) =>
    setMessages((courant) =>
      courant.map((message) =>
        message.id === idMessage
          ? { ...message, carte: null, donnees: null, texte: 'Demande abandonnée.' }
          : message,
      ),
    );

  const interrompre = () => {
    controleur.current?.abort();
    setEnCours(false);
    setActivite(null);
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label="Ouvrir l’assistant"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent text-ink shadow-lg transition hover:brightness-110"
      >
        <Bot size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section
      aria-label="Assistant SmartBot"
      className="fixed bottom-5 right-5 z-40 flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
          <Bot size={18} className="text-accent" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-content">SmartBot</span>
          <span className="block text-xs text-content-muted">Assistant intelligent</span>
        </span>
        <IconButton icon={Minus} label="Réduire" onClick={() => setOuvert(false)} />
        <IconButton
          icon={X}
          label="Fermer et oublier la conversation"
          onClick={() => {
            interrompre();
            setOuvert(false);
            setMessages([]);
            setConversationId(null);
            ecrireSession(null);
          }}
        />
      </header>

      <div ref={liste} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="rounded-xl bg-surface-raised px-3 py-2 text-sm text-content">
            Bonjour. Je peux vous aider à trouver une salle, comprendre une règle de réservation
            ou ouvrir un ticket.
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.de === 'moi' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div className={message.de === 'moi' ? 'max-w-[85%]' : 'max-w-[92%]'}>
              {message.texte && (
                <p
                  className={
                    message.de === 'moi'
                      ? 'whitespace-pre-wrap rounded-xl bg-accent px-3 py-2 text-sm text-ink'
                      : 'whitespace-pre-wrap rounded-xl bg-surface-raised px-3 py-2 text-sm text-content'
                  }
                >
                  {message.texte}
                </p>
              )}

              {message.de === 'bot' && (
                <CarteAssistant
                  sorte={message.carte}
                  donnees={message.donnees}
                  occupe={enCours}
                  onConfirmer={valider}
                  onAbandonner={() => abandonner(message.id)}
                />
              )}

              {message.reserve && (
                <p className="mt-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-content">
                  {message.reserve}
                </p>
              )}

              {message.sources?.length > 0 && (
                <p className="mt-1.5 text-xs text-content-muted">
                  Source{message.sources.length > 1 ? 's' : ''} : {message.sources.join(' · ')}
                </p>
              )}
            </div>
          </div>
        ))}

        {activite && (
          <p className="flex items-center gap-2 text-xs text-content-muted" role="status">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            {activite}…
          </p>
        )}
      </div>

      {suggestions.length > 0 && !enCours && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => envoyer(suggestion)}
              className="rounded-full border border-line bg-surface-raised px-2.5 py-1 text-xs text-content-muted transition hover:border-accent/50 hover:text-content"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          envoyer();
        }}
        className="flex items-center gap-2 border-t border-line px-3 py-2.5"
      >
        <input
          value={saisie}
          onChange={(event) => setSaisie(event.target.value)}
          placeholder="Écrivez votre message…"
          aria-label="Message pour l’assistant"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-content outline-none transition placeholder:text-content-faint focus:border-accent/60"
        />
        {enCours ? (
          <IconButton icon={Square} label="Interrompre la réponse" onClick={interrompre} />
        ) : (
          <button
            type="submit"
            aria-label="Envoyer"
            disabled={!saisie.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  );
}
