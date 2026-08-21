import { Bot, CornerDownRight } from 'lucide-react';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';

/**
 * A-14 — scénarios du chatbot.
 *
 * En lecture seule : ce sont les intentions que le chatbot de l'espace
 * utilisateur reconnaît réellement. Les afficher ici montre au support ce que
 * le robot sait traiter avant qu'un ticket ne remonte.
 */
export function ChatbotIntents({ intents = [] }) {
  return (
    <Card>
      <CardHeader
        title="Scénarios du chatbot"
        subtitle={`${intents.length} intention(s) reconnue(s) automatiquement`}
        icon={Bot}
      />
      <ul className="flex flex-col divide-y divide-line px-4 pb-4">
        {intents.map((intent) => (
          <li key={intent.id} className="flex flex-col gap-1.5 py-3">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-content">{intent.label}</span>
              {intent.escalates && <Badge tone="warning">Bascule vers un ticket</Badge>}
            </span>

            {intent.keywords?.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {intent.keywords.map((mot) => (
                  <span
                    key={mot}
                    className="rounded-md border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-content-muted"
                  >
                    {mot}
                  </span>
                ))}
              </span>
            )}

            {intent.answer && (
              <span className="flex items-start gap-1.5 text-xs text-content-muted">
                <CornerDownRight size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="line-clamp-2">{intent.answer}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
