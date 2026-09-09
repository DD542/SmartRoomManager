import { cn } from '../../utils/cn';

const TONE = {
  disponible: { fill: 'rgb(var(--success) / 0.10)', stroke: 'rgb(var(--success))', label: 'Libre' },
  occupee: { fill: 'rgb(var(--line) / 0.9)', stroke: 'rgb(var(--line-strong))', label: 'Occupée' },
  maintenance: { fill: 'rgb(var(--warning) / 0.10)', stroke: 'rgb(var(--warning))', label: 'Maintenance' },
  mienne: { fill: 'rgb(var(--accent) / 0.22)', stroke: 'rgb(var(--accent))', label: 'Votre salle' },
};

/**
 * Plan d'étage interactif rendu en SVG.
 * Chaque salle est un bouton : navigable au clavier, décrite par un aria-label
 * complet, et jamais identifiée par la seule couleur (le statut est écrit).
 */
export function FloorPlan({
  plan,
  rooms = [],
  mineIds = [],
  selectedId,
  onSelect,
  document: planImage,
  className,
}) {
  if (!plan) return null;

  // Quand l'administration a déposé une image, elle devient le fond du plan et
  // le schéma générique s'efface : les salles restent posées par-dessus.
  const hasImage = planImage?.type === 'image';

  return (
    <div className={cn('rounded-xl border border-line bg-ink p-3', className)}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        // 18 rem au téléphone, 26 au-delà : 416 px de haut sur un écran de
        // 667 px ne laissaient plus rien voir du reste de la page.
        className="h-[18rem] w-full md:h-[26rem]"
        role="group"
        aria-label={
          hasImage
            ? `Plan officiel de ${plan.label}, salles positionnées par-dessus`
            : `Schéma interactif — ${plan.label}`
        }
      >
        <defs>
          <pattern id="grille" width="4" height="4" patternUnits="userSpaceOnUse">
            <path d="M4 0 L0 0 0 4" fill="none" stroke="rgb(var(--surface))" strokeWidth="0.3" />
          </pattern>
        </defs>

        {hasImage ? (
          <image
            href={planImage.url}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid slice"
            opacity="0.85"
          />
        ) : (
          <rect width="100" height="100" fill="url(#grille)" />
        )}

        {!hasImage &&
          plan.corridors.map((corridor) => (
            <rect
              key={`${corridor.x}-${corridor.y}`}
              x={corridor.x}
              y={corridor.y}
              width={corridor.w}
              height={corridor.h}
              fill="rgb(var(--ink-soft))"
              stroke="rgb(var(--line))"
              strokeWidth="0.3"
            />
          ))}

        {rooms.map((room) => {
          const status = mineIds.includes(room.id) ? 'mienne' : room.status;
          const tone = TONE[status] ?? TONE.occupee;
          const selected = room.id === selectedId;

          return (
            <g key={room.id}>
              <rect
                x={room.plan.x}
                y={room.plan.y}
                width={room.plan.w}
                height={room.plan.h}
                rx="1.5"
                fill={tone.fill}
                stroke={selected ? 'rgb(var(--accent))' : tone.stroke}
                strokeWidth={selected ? 0.9 : 0.5}
                className="cursor-pointer transition-[stroke-width]"
                role="button"
                tabIndex={0}
                aria-label={`${room.name}, ${room.floor}, ${tone.label}, ${room.capacity} personnes`}
                aria-pressed={selected}
                onClick={() => onSelect?.(room)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(room);
                  }
                }}
              />
              <text
                x={room.plan.x + room.plan.w / 2}
                y={room.plan.y + room.plan.h / 2 - 1.5}
                textAnchor="middle"
                fontSize="3.4"
                fill="rgb(var(--content))"
                pointerEvents="none"
                style={{ paintOrder: 'stroke', stroke: 'rgb(var(--ink))', strokeWidth: 0.8 }}
              >
                {room.name}
              </text>
              <text
                x={room.plan.x + room.plan.w / 2}
                y={room.plan.y + room.plan.h / 2 + 3}
                textAnchor="middle"
                fontSize="2.6"
                fill={tone.stroke}
                pointerEvents="none"
                style={{ paintOrder: 'stroke', stroke: 'rgb(var(--ink))', strokeWidth: 0.8 }}
              >
                {room.floor} · {tone.label}
              </text>
            </g>
          );
        })}

        {/* Repère d'entrée : schématique, on ne le superpose pas au plan officiel.
            `plan.entrance` reste absent tant que l'API ne sert pas d'entrée pour
            l'étage — elle n'en a jamais servi, seul le plan de démonstration en
            portait une. Le lire sans vérifier faisait tomber la page entière sur
            « Cannot read properties of null », dès qu'un étage n'avait pas
            d'image de plan déposée. */}
        {!hasImage && plan.entrance && (
          <>
            <rect
              x={plan.entrance.x}
              y={plan.entrance.y}
              width={plan.entrance.w}
              height={plan.entrance.h}
              rx="0.8"
              fill="rgb(var(--surface-raised))"
              stroke="rgb(var(--accent))"
              strokeWidth="0.4"
            />
            <text
              x={plan.entrance.x + plan.entrance.w / 2}
              y={plan.entrance.y - 1}
              textAnchor="middle"
              fontSize="2.6"
              fill="rgb(var(--content-muted))"
            >
              {plan.entrance.label}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export function FloorPlanLegend({ legend = [] }) {
  const dot = { libre: 'rgb(var(--success))', occupee: 'rgb(var(--line-strong))', mienne: 'rgb(var(--accent))' };
  return (
    <ul className="flex flex-wrap gap-4">
      {legend.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-content-muted">
          <span
            className="h-2.5 w-2.5 rounded-sm border"
            style={{ borderColor: dot[item.key], background: `${dot[item.key]}22` }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
