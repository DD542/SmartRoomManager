// src/api/chatbot.js
// Endpoint réel :
//   POST /api/v1/chatbot/messages   rapproche le message d'une intention déclarée
//
// Les intentions et leurs mots-clés vivent en base : les modifier ne demande
// pas de redéploiement, et l'assistant ne fabrique aucune réponse. En deçà du
// seuil de confiance il le dit et propose un ticket — sur un système de
// réservation, une réponse inventée ferait plus de dégâts qu'un renvoi.

import { post } from './client';
import { recommendBest } from './recommendations';

const ACCUEIL = {
  reply:
    'Bonjour. Je peux vous aider à trouver une salle, comprendre une règle de réservation ou ouvrir un ticket.',
  quickReplies: [
    'Trouver une salle pour 4 personnes',
    'Comment annuler une réservation ?',
    'Je n’arrive pas à valider ma présence',
  ],
  intent: 'accueil',
  room: null,
};

export async function greet() {
  return { ...ACCUEIL, quickReplies: [...ACCUEIL.quickReplies] };
}

export async function sendMessage(text, context = {}) {
  const data = await post('/chatbot/messages', { message: text });

  const reponse = {
    reply: data.answer,
    intent: data.intent_code ?? 'inconnu',
    intentLabel: data.intent_label,
    quickReplies: data.quick_replies ?? [],
    escalates: data.escalates_to_ticket,
    articleId: data.faq_article_id,
    confidence: data.confidence,
    room: null,
  };

  // Une intention de recherche mérite une carte de salle : répondre « utilisez
  // la recherche » à qui demande une salle pour quatre personnes reviendrait à
  // renvoyer la question.
  if (reponse.intent && reponse.intent.startsWith('recherche')) {
    const suggestion = await recommendBest({
      attendees: extraireEffectif(text) ?? context.attendees ?? 4,
      buildingId: context.buildingId,
    }).catch(() => null);

    if (suggestion) {
      reponse.room = {
        ...suggestion.room,
        justification: suggestion.justification,
        score: suggestion.score,
      };
    }
  }

  return reponse;
}

const extraireEffectif = (texte) => {
  const trouve = /(\d{1,3})\s*(personnes?|pers\.?|places?)/i.exec(String(texte));
  return trouve ? Number(trouve[1]) : null;
};
