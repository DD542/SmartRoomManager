/**
 * Aperçu de l'interface rendu en SVG inline : aucune capture d'écran à charger,
 * aucun appel réseau, et le visuel suit automatiquement les couleurs du thème.
 */
export function AppPreview() {
  const slots = [
    { x: 214, y: 132, w: 52, h: 26, tone: '#3DDBA6' },
    { x: 274, y: 132, w: 52, h: 40, tone: '#5B9BFF' },
    { x: 334, y: 132, w: 52, h: 20, tone: '#3B4A66' },
    { x: 214, y: 168, w: 52, h: 34, tone: '#3B4A66' },
    { x: 274, y: 180, w: 52, h: 22, tone: '#FCC63F' },
    { x: 334, y: 160, w: 52, h: 42, tone: '#3B4A66' },
  ];

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <svg
        viewBox="0 0 420 260"
        className="h-auto w-full"
        role="img"
        aria-label="Aperçu de l’application : liste des salles, calendrier hebdomadaire et détection de conflit"
      >
        <rect width="420" height="260" rx="10" fill="#101623" />

        {/* Barre latérale */}
        <rect x="10" y="10" width="34" height="240" rx="8" fill="#1A2231" />
        <rect x="19" y="20" width="16" height="16" rx="5" fill="#5B9BFF" />
        {[48, 72, 96, 120].map((y) => (
          <rect key={y} x="19" y={y} width="16" height="10" rx="3" fill="#2C3850" />
        ))}

        {/* Barre haute */}
        <rect x="54" y="10" width="356" height="24" rx="7" fill="#1A2231" />
        <rect x="62" y="18" width="120" height="8" rx="4" fill="#2C3850" />
        <circle cx="396" cy="22" r="5" fill="#2C3850" />

        {/* Colonne des salles */}
        <rect x="54" y="42" width="146" height="208" rx="8" fill="#1A2231" />
        {[52, 104, 156].map((y, index) => (
          <g key={y}>
            <rect x="62" y={y} width="130" height="44" rx="6" fill="#222C3E" />
            <rect x="70" y={y + 10} width="62" height="7" rx="3" fill="#3B4A66" />
            <rect x="70" y={y + 24} width="86" height="6" rx="3" fill="#2C3850" />
            <circle cx="182" cy={y + 14} r="4" fill={index === 1 ? '#FCC63F' : '#3DDBA6'} />
          </g>
        ))}

        {/* Calendrier */}
        <rect x="208" y="42" width="202" height="208" rx="8" fill="#1A2231" />
        {[214, 274, 334].map((x) => (
          <rect key={x} x={x} y="52" width="52" height="8" rx="4" fill="#2C3850" />
        ))}
        {[74, 104, 134, 164, 194].map((y) => (
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
        <rect x="214" y="212" width="172" height="28" rx="6" fill="#FF8080" fillOpacity="0.12" stroke="#FF8080" strokeOpacity="0.4" />
        <circle cx="228" cy="226" r="5" fill="#FF8080" fillOpacity="0.8" />
        <rect x="240" y="222" width="98" height="7" rx="3" fill="#FF8080" fillOpacity="0.5" />
      </svg>
    </div>
  );
}
