import { CheckCircle2, KeyRound } from 'lucide-react';

/**
 * Aperçu de l'interface : fenêtre de navigateur dessinée en SVG, surmontée de
 * deux cartes flottantes en HTML. Aucune capture d'écran à charger, aucun appel
 * réseau, et le visuel suit les couleurs du thème.
 */
export function AppPreview() {
  const slots = [
    { x: 214, y: 128, w: 52, h: 26, tone: '#3DDBA6' },
    { x: 274, y: 128, w: 52, h: 40, tone: '#5B9BFF' },
    { x: 334, y: 128, w: 52, h: 20, tone: '#3B4A66' },
    { x: 214, y: 164, w: 52, h: 34, tone: '#3B4A66' },
    { x: 274, y: 176, w: 52, h: 22, tone: '#FCC63F' },
    { x: 334, y: 156, w: 52, h: 42, tone: '#3B4A66' },
  ];

  return (
    <div className="relative">
      <div className="rounded-xl border border-line bg-surface p-3">
        <svg
          viewBox="0 0 420 260"
          className="h-auto w-full"
          role="img"
          aria-label="Aperçu de l’application : liste des salles, calendrier hebdomadaire et détection de conflit"
        >
          <rect width="420" height="260" rx="10" fill="#101623" />

          {/* Barre de fenêtre */}
          <rect x="10" y="10" width="400" height="18" rx="6" fill="#1A2231" />
          {[20, 30, 40].map((cx) => (
            <circle key={cx} cx={cx} cy="19" r="3" fill="#3B4A66" />
          ))}

          {/* Barre latérale */}
          <rect x="10" y="36" width="34" height="214" rx="8" fill="#1A2231" />
          <rect x="19" y="46" width="16" height="16" rx="5" fill="#5B9BFF" />
          {[74, 98, 122, 146].map((y) => (
            <rect key={y} x="19" y={y} width="16" height="10" rx="3" fill="#2C3850" />
          ))}

          {/* Barre haute */}
          <rect x="54" y="36" width="356" height="24" rx="7" fill="#1A2231" />
          <rect x="62" y="44" width="120" height="8" rx="4" fill="#2C3850" />
          <circle cx="396" cy="48" r="5" fill="#2C3850" />

          {/* Colonne des salles */}
          <rect x="54" y="68" width="146" height="182" rx="8" fill="#1A2231" />
          {[78, 130, 182].map((y, index) => (
            <g key={y}>
              <rect x="62" y={y} width="130" height="44" rx="6" fill="#222C3E" />
              <rect x="70" y={y + 10} width="62" height="7" rx="3" fill="#3B4A66" />
              <rect x="70" y={y + 24} width="86" height="6" rx="3" fill="#2C3850" />
              <circle cx="182" cy={y + 14} r="4" fill={index === 1 ? '#FCC63F' : '#3DDBA6'} />
            </g>
          ))}

          {/* Calendrier */}
          <rect x="208" y="68" width="202" height="182" rx="8" fill="#1A2231" />
          {[214, 274, 334].map((x) => (
            <rect key={x} x={x} y="78" width="52" height="8" rx="4" fill="#2C3850" />
          ))}
          {[100, 130, 160, 190].map((y) => (
            <line key={y} x1="214" y1={y} x2="386" y2={y} stroke="#2C3850" strokeWidth="1" />
          ))}
          {slots.map((slot) => (
            <rect
              key={`${slot.x}-${slot.y}`}
              x={slot.x}
              y={slot.y}
              width={slot.w}
              height={slot.h}
              rx="4"
              fill={slot.tone}
              fillOpacity={slot.tone === '#3B4A66' ? 0.7 : 0.28}
              stroke={slot.tone}
              strokeOpacity="0.6"
            />
          ))}

          {/* Bandeau de conflit */}
          <rect
            x="214"
            y="212"
            width="172"
            height="28"
            rx="6"
            fill="#FF8080"
            fillOpacity="0.12"
            stroke="#FF8080"
            strokeOpacity="0.4"
          />
          <circle cx="228" cy="226" r="5" fill="#FF8080" fillOpacity="0.8" />
          <rect x="240" y="222" width="98" height="7" rx="3" fill="#FF8080" fillOpacity="0.5" />
        </svg>
      </div>

      {/* Carte flottante : confirmation de réservation */}
      <div
        aria-hidden="true"
        className="absolute -right-3 top-8 hidden items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3 py-2.5 sm:flex"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-success/40 bg-success-soft">
          <CheckCircle2 size={16} className="text-success" />
        </span>
        <span>
          <span className="block text-xs font-medium text-content">Salle réservée</span>
          <span className="block font-mono text-[11px] text-content-muted">
            Salle Turing · 14:00
          </span>
        </span>
      </div>

      {/* Carte flottante : code d'accès */}
      <div
        aria-hidden="true"
        className="absolute -left-4 bottom-10 hidden items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3 py-2.5 sm:flex"
      >
        <KeyRound size={15} className="text-accent" />
        <span>
          <span className="block text-[10px] uppercase tracking-wide text-content-muted">
            Code d’accès
          </span>
          <span className="block font-mono text-sm tracking-[0.15em] text-content">A-4821</span>
        </span>
      </div>
    </div>
  );
}
