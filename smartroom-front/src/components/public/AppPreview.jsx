import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';

const ROOMS = [
  { x: 168, y: 104, libre: true },
  { x: 286, y: 104, libre: false },
  { x: 404, y: 104, libre: true },
  { x: 168, y: 212, libre: true },
  { x: 286, y: 212, libre: true },
  { x: 404, y: 212, libre: true },
];

/** Carte de salle miniature : photo, statut, équipements, disponibilités, action. */
function RoomCard({ x, y, libre }) {
  const teinte = libre ? '#3DDBA6' : '#FF8080';

  return (
    <g>
      <rect x={x} y={y} width="106" height="96" rx="6" fill="#1A2231" />
      <rect x={x + 6} y={y + 6} width="94" height="34" rx="4" fill="#222C3E" />
      <rect x={x + 6} y={y + 46} width="46" height="6" rx="3" fill="#3B4A66" />
      <rect
        x={x + 62}
        y={y + 44}
        width="38"
        height="10"
        rx="5"
        fill={teinte}
        fillOpacity="0.18"
        stroke={teinte}
        strokeOpacity="0.5"
        strokeWidth="0.6"
      />
      <rect x={x + 6} y={y + 58} width="60" height="4" rx="2" fill="#2C3850" />

      {/* Bande de disponibilité horaire */}
      {Array.from({ length: 9 }, (_, index) => (
        <rect
          key={index}
          x={x + 6 + index * 10.6}
          y={y + 68}
          width="8"
          height="5"
          rx="1.5"
          fill={index < 6 ? '#5B9BFF' : '#2C3850'}
          fillOpacity={index < 6 ? 0.8 : 1}
        />
      ))}

      <rect x={x + 6} y={y + 80} width="44" height="10" rx="4" fill="#5B9BFF" />
      <rect x={x + 74} y={y + 83} width="26" height="4" rx="2" fill="#3B4A66" />
    </g>
  );
}

/**
 * Aperçu de l'application dans un écran, avec deux cartes flottantes.
 *
 * Tout est dessiné : aucune capture d'écran à charger, aucun appel réseau, et
 * le visuel suit les couleurs du thème. Le survol anime légèrement l'ensemble ;
 * la règle globale `prefers-reduced-motion` neutralise ces transitions.
 */
export function AppPreview() {
  const [survol, setSurvol] = useState(false);

  // Transformations pilotées en ligne : rotation et translation composées dans
  // une seule transition, sans dépendre de l'ordre du cascade CSS.
  const carte = (rotationRepos, rotationSurvol, decalage) => ({
    transform: survol
      ? `rotate(${rotationSurvol}deg) translateY(${decalage}px)`
      : `rotate(${rotationRepos}deg)`,
    transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
  });

  return (
    <div
      className="relative select-none"
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
    >
      <svg
        viewBox="0 0 560 386"
        className="h-auto w-full"
        style={{
          transform: survol ? 'translateY(-4px)' : 'none',
          transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        role="img"
        aria-label="Aperçu de l’application : catalogue des salles disponibles, confirmation de réservation et code d’accès"
      >
        {/* Écran */}
        <rect x="30" y="16" width="500" height="312" rx="14" fill="#1A2231" />
        <rect x="42" y="28" width="476" height="288" rx="8" fill="#101623" />

        {/* Barre de navigation de l'application */}
        <rect x="42" y="28" width="476" height="26" fill="#1A2231" />
        <rect x="54" y="35" width="12" height="12" rx="4" fill="#5B9BFF" />
        <rect x="72" y="37" width="40" height="4" rx="2" fill="#3B4A66" />
        <rect x="72" y="44" width="28" height="3" rx="1.5" fill="#2C3850" />
        {[300, 340, 380, 420].map((cx) => (
          <rect key={cx} x={cx} y={38} width="28" height="5" rx="2.5" fill="#2C3850" />
        ))}
        <circle cx="500" cy="41" r="7" fill="#222C3E" />

        {/* Titre de page */}
        <text x="56" y="76" fill="#F7FAFF" fontSize="13" fontWeight="600">
          Réservez votre salle idéale
        </text>
        <rect x="56" y="84" width="190" height="4" rx="2" fill="#2C3850" />

        {/* Mini calendrier */}
        <rect x="56" y="104" width="100" height="204" rx="6" fill="#1A2231" />
        <rect x="64" y="112" width="60" height="5" rx="2.5" fill="#3B4A66" />
        {Array.from({ length: 28 }, (_, index) => {
          const colonne = index % 7;
          const ligne = Math.floor(index / 7);
          const actif = index === 16;
          return actif ? (
            <circle key={index} cx={68 + colonne * 13} cy={132 + ligne * 14} r="5" fill="#5B9BFF" />
          ) : (
            <rect
              key={index}
              x={64 + colonne * 13}
              y={128 + ligne * 14}
              width="8"
              height="8"
              rx="2"
              fill="#222C3E"
            />
          );
        })}
        <rect x="64" y="200" width="84" height="8" rx="4" fill="#222C3E" />
        <rect x="64" y="216" width="84" height="8" rx="4" fill="#222C3E" />
        <rect x="64" y="288" width="52" height="12" rx="6" fill="#222C3E" />

        {/* Grille des salles */}
        {ROOMS.map((room) => (
          <RoomCard key={`${room.x}-${room.y}`} {...room} />
        ))}

        {/* Pied et socle de l'écran */}
        <path d="M250 328 h60 l10 26 h-80 z" fill="#1A2231" />
        <rect x="212" y="352" width="136" height="10" rx="5" fill="#222C3E" />
      </svg>

      {/* Carte flottante : confirmation de réservation.
          Le flottement est porté par l'enveloppe et l'inclinaison par la carte :
          deux `transform` sur le même nœud s'écraseraient, et le survol
          effacerait le mouvement. */}
      <div aria-hidden="true" className="absolute -right-2 top-10 hidden sm:block animate-flottement">
      <div
        style={carte(-5, -2, -10)}
        className="flex items-center gap-3 rounded-xl border border-line
                   bg-surface-raised px-4 py-3"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-success/40 bg-success-soft">
          <CheckCircle2 size={18} className="text-success" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-content">Salle réservée</span>
          <span className="block font-mono text-xs text-content-muted">Salle Turing — 14:00</span>
        </span>
      </div>
      </div>

      {/* Carte flottante : code d'accès. Décalée d'une demi-période pour que
          les deux cartes ne montent pas ensemble. */}
      <div
        aria-hidden="true"
        className="absolute -left-3 bottom-16 hidden sm:block animate-flottement"
        style={{ animationDelay: '-3s' }}
      >
      <div
        style={carte(6, 3, 10)}
        className="flex items-center gap-3 rounded-xl border border-line
                   bg-surface-raised px-4 py-3"
      >
        <KeyRound size={16} className="text-accent" />
        <span>
          <span className="block text-[10px] uppercase tracking-wide text-content-muted">
            Code d’accès
          </span>
          <span className="block font-mono text-base tracking-[0.15em] text-content">A-4821</span>
        </span>
      </div>
      </div>
    </div>
  );
}
