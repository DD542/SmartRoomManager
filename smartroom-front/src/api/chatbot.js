// src/api/chatbot.js
// Endpoint FastAPI cible :
//   POST /api/chatbot/messages   { text, context } -> { reply, room?, quickReplies }

import { chatFallback, chatGreeting, chatIntents } from '../mocks/chatScripts';
import { rooms } from '../mocks/rooms';
import { buildings } from '../mocks/buildings';
import { bestRoom } from '../utils/recommendation';
import { normalize } from '../utils/format';
import { clone, delay } from './client';

/** Extrait un effectif d'une phrase : « une salle de 6 personnes ». */
function extractAttendees(text) {
  const match = normalize(text).match(/(\d+)\s*(personnes?|pers|places?)/);
  return match ? Number(match[1]) : null;
}

function matchIntent(text) {
  const normalized = normalize(text);
  let best = null;
  let bestScore = 0;
  for (const intent of chatIntents) {
    const score = intent.keywords.filter((keyword) => normalized.includes(normalize(keyword))).length;
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export async function greet() {
  await delay(200);
  return clone(chatGreeting);
}

export async function sendMessage(text, context = {}) {
  await delay();
  const intent = matchIntent(text);
  if (!intent) return { ...clone(chatFallback), intent: 'inconnu' };

  if (!intent.withRoomCard) {
    return { reply: intent.reply, quickReplies: clone(intent.quickReplies), intent: intent.id, room: null };
  }

  const attendees = extractAttendees(text) ?? context.attendees ?? 4;
  const suggestion = bestRoom(
    rooms.filter((room) => room.status !== 'maintenance'),
    { attendees, equipmentIds: [], buildingId: context.buildingId },
  );

  return {
    reply: intent.reply,
    intent: intent.id,
    quickReplies: clone(intent.quickReplies),
    room: suggestion
      ? {
          ...clone(suggestion.room),
          building: clone(buildings.find((b) => b.id === suggestion.room.buildingId)) ?? null,
          justification: suggestion.justification,
          score: suggestion.score,
        }
      : null,
    attendees,
  };
}
