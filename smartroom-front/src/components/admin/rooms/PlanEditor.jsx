import { useRef, useState } from 'react';
import { cn } from '../../../utils/cn';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

/** Pas de la grille magnétique, en unités du viewBox (soit 2 % du plan). */
export const PAS = 2;

/**
 * Largeur en dessous de laquelle le plan se consulte sans se modifier.
 *
 * Décision assumée, et non un oubli. Le canevas demande de saisir un
 * rectangle de cinq unités sur cent et de le poser au pas de 2 % : à 360 px de
 * large, la cible fait 18 px et se déplace par bonds de 7 px, sous le seuil
 * tactile et sans repère suffisant pour viser. Un doigt masque en outre la
 * salle qu'il déplace.
 *
 * L'adapter demanderait un autre mode de saisie — poignées agrandies, zoom,
 * coordonnées au clavier — c'est-à-dire un second éditeur à écrire et à
 * maintenir, pour un geste qu'on fait une fois par salle, assis. Le reste de
 * l'écran — arbre des bâtiments, dépôt du plan, propriétés — reste utilisable
 * partout ; seul le glisser-déposer s'arrête ici, et il le dit.
 */
export const EDITION_MIN_PX = 1024;

const aligner = (valeur) => Math.round(valeur / PAS) * PAS;

/**
 * A-08 — canevas de placement des salles.
 *
 * Le glisser-déposer travaille dans le repère du viewBox, pas en pixels : le
 * placement reste identique quelle que soit la taille d'affichage. Chaque salle
 * est aussi déplaçable au clavier, d'un pas de grille par flèche — un éditeur
 * uniquement à la souris exclurait une partie des utilisateurs.
 */
export function PlanEditor({ layout, selectedId, onSelect, onMove, onCommit, className }) {
  const svgRef = useRef(null);
  const [glisse, setGlisse] = useState(null);
  // Limite assumée : voir la note de l'export `EDITION_MIN_PX`.
  const editable = useMediaQuery(`(min-width: ${EDITION_MIN_PX}px)`);

  const versPlan = (event) => {
    const cadre = svgRef.current?.getBoundingClientRect();
    if (!cadre) return null;
    return {
      x: ((event.clientX - cadre.left) / cadre.width) * 100,
      y: ((event.clientY - cadre.top) / cadre.height) * 100,
    };
  };

  const demarrer = (event, pose) => {
    const point = versPlan(event);
    if (!point) return;
    // La sélection d'abord : la capture de pointeur peut échouer selon le
    // périphérique, et cet échec ne doit pas empêcher d'ouvrir le panneau.
    onSelect(pose.room.id);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture indisponible : le glisser reste géré par les événements du SVG.
    }
    setGlisse({
      roomId: pose.room.id,
      // Décalage entre le coin de la salle et le point saisi : sans lui, la
      // salle saute sous le curseur au premier pixel de déplacement.
      dx: point.x - pose.room.plan.x,
      dy: point.y - pose.room.plan.y,
    });
  };

  // Derniere position calculee, hors etat React.
  //
  // `onCommit` lisait la position depuis l'etat du parent, qui n'avait pas
  // encore recu le `onMove` de la meme frappe : la geometrie enregistree avait
  // systematiquement un pas de retard sur celle affichee. Sept fleches
  // deplacaient la salle a l'ecran et n'en enregistraient que six.
  const derniere = useRef(null);

  const deplacer = (event) => {
    if (!glisse) return;
    const point = versPlan(event);
    if (!point) return;
    const salle = layout.placed.find((pose) => pose.room.id === glisse.roomId);
    if (!salle) return;
    const suivante = {
      x: borner(aligner(point.x - glisse.dx), salle.room.plan.w),
      y: borner(aligner(point.y - glisse.dy), salle.room.plan.h),
    };
    derniere.current = suivante;
    onMove(glisse.roomId, suivante);
  };

  const relacher = () => {
    if (!glisse) return;
    onCommit(glisse.roomId, derniere.current ?? undefined);
    derniere.current = null;
    setGlisse(null);
  };

  const auClavier = (event, pose) => {
    const pas = { ArrowLeft: [-PAS, 0], ArrowRight: [PAS, 0], ArrowUp: [0, -PAS], ArrowDown: [0, PAS] }[
      event.key
    ];
    if (!pas) return;
    event.preventDefault();
    const suivante = {
      x: borner(pose.room.plan.x + pas[0], pose.room.plan.w),
      y: borner(pose.room.plan.y + pas[1], pose.room.plan.h),
    };
    onMove(pose.room.id, suivante);
    onCommit(pose.room.id, suivante);
  };

  return (
    <div className={cn('rounded-xl border border-line bg-ink p-3', className)}>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="h-[28rem] w-full touch-none"
        role="group"
        aria-label={`Éditeur du plan — ${layout.label}`}
        onPointerMove={editable ? deplacer : undefined}
        onPointerUp={editable ? relacher : undefined}
        onPointerLeave={editable ? relacher : undefined}
      >
        <defs>
          <pattern id="grille-editeur" width={PAS} height={PAS} patternUnits="userSpaceOnUse">
            <path
              d={`M${PAS} 0 L0 0 0 ${PAS}`}
              fill="none"
              stroke="#2C3850"
              strokeWidth="0.25"
            />
          </pattern>
        </defs>

        {layout.document?.type === 'image' ? (
          <image
            href={layout.document.url}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid slice"
            opacity="0.7"
          />
        ) : null}
        <rect width="100" height="100" fill="url(#grille-editeur)" />

        {layout.placed.map((pose) => (
          <SallePosee
            key={pose.room.id}
            pose={pose}
            actif={selectedId === pose.room.id}
            enCours={glisse?.roomId === pose.room.id}
            onPointerDown={editable ? (event) => demarrer(event, pose) : () => onSelect(pose.room.id)}
            onKeyDown={editable ? (event) => auClavier(event, pose) : undefined}
          />
        ))}
      </svg>

      {!editable && (
        // Dit ce qui est possible ici, et où faire le reste. Un écran qui
        // refuse sans expliquer se lit comme une panne.
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-content">
          Le plan se consulte à cette largeur : toucher une salle affiche ses
          propriétés. Le déplacement demande un écran d’au moins{' '}
          {EDITION_MIN_PX} px.
        </p>
      )}

      <p className="mt-2 text-[11px] text-content-faint">
        Glissez une salle pour la déplacer, ou sélectionnez-la et utilisez les flèches du clavier.
        Le placement s’aligne sur une grille de {PAS} %.
      </p>
    </div>
  );
}

function SallePosee({ pose, actif, enCours, onPointerDown, onKeyDown }) {
  const { x, y, w, h } = pose.room.plan;
  const centre = { x: x + w / 2, y: y + h / 2 };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${pose.room.name}, position ${Math.round(x)} % ${Math.round(y)} %`}
      aria-pressed={actif}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      transform={`rotate(${pose.rotation} ${centre.x} ${centre.y})`}
      className="cursor-move focus:outline-none"
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="1.5"
        fill={actif ? 'rgba(91,155,255,0.28)' : 'rgba(34,44,62,0.9)'}
        stroke={actif ? '#5B9BFF' : '#3B4A66'}
        strokeWidth={actif ? 0.6 : 0.35}
        style={{ transition: enCours ? 'none' : 'fill 180ms' }}
      />
      <text
        x={centre.x}
        y={centre.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#F7FAFF"
        fontSize="2.4"
        fontFamily="ui-monospace, monospace"
        pointerEvents="none"
      >
        {pose.room.name.replace('Salle ', '')}
      </text>

      {pose.entrance && (
        // Marqueur d'entrée : un trait épais sur le bord bas de la salle.
        <line
          x1={centre.x - w / 4}
          y1={y + h}
          x2={centre.x + w / 4}
          y2={y + h}
          stroke="#3DDBA6"
          strokeWidth="1"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

const borner = (valeur, taille) => Math.min(100 - taille, Math.max(0, valeur));
