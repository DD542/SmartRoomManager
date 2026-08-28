// src/api/assistant.js
// Endpoints réels :
//   POST   /api/v1/chat/messages            flux d'événements SSE
//   POST   /api/v1/chat/confirmations       exécution d'une action confirmée
//   GET    /api/v1/chat/conversations       mes fils
//   GET    /api/v1/chat/conversations/{id}  reprise après rechargement
//   DELETE /api/v1/chat/conversations/{id}
//
// Le flux est lu par `fetch` et un `ReadableStream`, pas par `EventSource` :
// ce dernier ne sait émettre qu'un GET, et le message partirait alors en
// paramètre d'URL, où il finirait dans les journaux d'accès. Aucune dépendance
// n'est ajoutée d'un côté comme de l'autre — `fetch` et `TextDecoder` sont
// natifs.

import { API_BASE, ApiError, del, get, getAccessToken } from './client';

/**
 * Découpe un flux SSE en événements.
 *
 * Le tampon est nécessaire : une trame peut arriver coupée en deux paquets
 * TCP, et analyser chaque morceau isolément produirait du JSON tronqué une
 * fois sur dix — le genre de défaut qui n'apparaît qu'en conditions réelles.
 */
async function* trames(reponse, signal) {
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';

  try {
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;

      // Fins de ligne normalisées : `sse-starlette` sépare ses trames par
      // `\r\n\r\n`, là où la spécification SSE admet les deux formes. Chercher
      // `\n\n` dans un flux en CRLF ne trouve rien — jamais — et le panneau
      // restait muet sans qu'aucune erreur ne soit levée : la requête aboutit,
      // le flux se ferme, et zéro événement en sort.
      tampon += decodeur.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let coupure = tampon.indexOf('\n\n');
      while (coupure !== -1) {
        const brut = tampon.slice(0, coupure);
        tampon = tampon.slice(coupure + 2);
        coupure = tampon.indexOf('\n\n');

        const charge = brut
          .split('\n')
          .filter((ligne) => ligne.startsWith('data:'))
          .map((ligne) => ligne.slice(5).trim())
          .join('');

        if (charge) {
          try {
            yield JSON.parse(charge);
          } catch {
            // Une trame illisible n'interrompt pas la conversation : elle est
            // ignorée. Interrompre coûterait la réponse entière pour un octet.
          }
        }
      }
    }
  } finally {
    // Annulation demandée par l'utilisateur : la lecture s'arrête ici, et le
    // serveur voit la connexion se fermer — ce qui interrompt la génération.
    if (signal?.aborted) await lecteur.cancel().catch(() => {});
    lecteur.releaseLock?.();
  }
}

async function ouvrir(chemin, corps, { signal } = {}) {
  const reponse = await fetch(`${API_BASE}${chemin}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify(corps),
    credentials: 'include',
    signal,
  });

  if (!reponse.ok) {
    const charge = await reponse.json().catch(() => null);
    throw new ApiError(
      charge?.error?.message ?? 'L’assistant est indisponible.',
      reponse.status,
      charge?.error?.code ?? 'assistant_indisponible',
    );
  }
  return reponse;
}

/** Pose une question et rend les événements au fil de l'eau. */
export async function* demander(message, { conversationId = null, signal } = {}) {
  const reponse = await ouvrir(
    '/chat/messages',
    { message, ...(conversationId ? { conversation_id: conversationId } : {}) },
    { signal },
  );
  yield* trames(reponse, signal);
}

/** Confirme une action proposée. Le serveur exécute le brouillon qu'il détient. */
export async function* confirmer(jetonAction, { conversationId = null, signal } = {}) {
  const reponse = await ouvrir(
    '/chat/confirmations',
    { jeton: jetonAction, ...(conversationId ? { conversation_id: conversationId } : {}) },
    { signal },
  );
  yield* trames(reponse, signal);
}

export async function listerConversations({ signal } = {}) {
  const lignes = await get('/chat/conversations', { signal });
  return lignes.map((ligne) => ({
    id: ligne.id,
    titre: ligne.titre,
    messages: ligne.messages,
    derniereActivite: ligne.derniere_activite ? new Date(ligne.derniere_activite) : null,
  }));
}

export async function relireConversation(id, { signal } = {}) {
  const data = await get(`/chat/conversations/${id}`, { signal });
  return {
    id: data.id,
    titre: data.titre,
    messages: (data.messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      texte: message.contenu,
      carte: message.carte,
      donnees: message.donnees,
      sources: message.sources ?? [],
      quand: message.quand ? new Date(message.quand) : null,
    })),
  };
}

export async function supprimerConversation(id) {
  await del(`/chat/conversations/${id}`);
}
