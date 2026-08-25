import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Minus, Send, X } from 'lucide-react';
import { greet, sendMessage } from '../../api/chatbot';
import { fmtCapacity } from '../../utils/format';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/Button';

let messageId = 0;

/** Carte de salle proposée par le bot, dérivée du moteur de recommandation. */
function RoomSuggestion({ room }) {
  return (
    <Link
      to={`/app/salles/${room.id}`}
      className="mt-2 block overflow-hidden rounded-xl border border-line bg-surface transition hover:border-accent/50"
    >
      <img src={room.photos?.[0]} alt="" className="h-20 w-full object-cover" />
      <span className="block px-3 py-2">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm text-content">{room.name}</span>
          <Badge tone="accent">{room.score} / 100</Badge>
        </span>
        <span className="mt-0.5 block text-xs text-content-muted">
          {fmtCapacity(room.capacity)} • {room.building?.name}
        </span>
        <span className="mt-1 block text-xs text-content-muted">{room.justification}</span>
      </span>
    </Link>
  );
}

/**
 * U-23 — Chatbot d'assistance, monté dans AppLayout et donc disponible sur
 * toutes les pages de l'espace connecté.
 */
export function ChatbotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [quickReplies, setQuickReplies] = useState([]);
  const [value, setValue] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open || messages.length > 0) return;
    greet().then((answer) => {
      setMessages([{ id: (messageId += 1), from: 'bot', text: answer.reply }]);
      setQuickReplies(answer.quickReplies);
    });
  }, [open, messages.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  const submit = async (text) => {
    const content = text ?? value;
    if (!content.trim()) return;
    setMessages((current) => [...current, { id: (messageId += 1), from: 'user', text: content }]);
    setValue('');
    setTyping(true);
    const answer = await sendMessage(content);
    setTyping(false);
    setMessages((current) => [
      ...current,
      { id: (messageId += 1), from: 'bot', text: answer.reply, room: answer.room },
    ]);
    setQuickReplies(answer.quickReplies ?? []);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir l’assistant SmartBot"
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/50 bg-accent text-ink transition hover:bg-accent-hover md:bottom-6"
      >
        <Bot size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section
      aria-label="Assistant SmartBot"
      className="fixed bottom-20 right-4 z-40 flex h-[26rem] w-[min(22rem,calc(100vw-2rem))] flex-col rounded-xl border border-line bg-surface md:bottom-6"
    >
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/40 bg-accent-soft">
          <Bot size={16} aria-hidden="true" className="text-accent" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-content">SmartBot</p>
          <p className="text-xs text-content-muted">Assistant intelligent</p>
        </div>
        <IconButton icon={Minus} label="Réduire l’assistant" onClick={() => setOpen(false)} />
        <IconButton
          icon={X}
          label="Fermer et effacer la conversation"
          onClick={() => {
            setOpen(false);
            setMessages([]);
          }}
        />
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={message.from === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  message.from === 'user'
                    ? 'bg-accent text-ink'
                    : 'border border-line bg-surface-raised text-content'
                }`}
              >
                {message.text}
                {message.room && <RoomSuggestion room={message.room} />}
              </div>
            </li>
          ))}
          {typing && (
            <li className="text-xs text-content-muted" aria-live="polite">
              SmartBot écrit…
            </li>
          )}
        </ul>
      </div>

      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => submit(reply)}
              className="rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-content-muted transition hover:text-content"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 border-t border-line px-3 py-2.5"
      >
        <label htmlFor="chatbot-message" className="sr-only">
          Votre message pour SmartBot
        </label>
        <input
          id="chatbot-message"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Écrivez votre message…"
          className="h-9 flex-1 rounded-xl border border-line bg-surface-raised px-3 text-sm text-content placeholder:text-content-faint focus:border-accent focus:outline-none"
        />
        <IconButton icon={Send} label="Envoyer le message" variant="primary" type="submit" />
      </form>
    </section>
  );
}
