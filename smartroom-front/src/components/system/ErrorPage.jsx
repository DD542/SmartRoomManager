import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';

/** Illustration commune aux écrans d'erreur : une salle vide, dessinée en SVG. */
function EmptyRoom({ code }) {
  return (
    <svg
      viewBox="0 0 260 170"
      className="mx-auto h-40 w-auto"
      role="img"
      aria-label={`Illustration : salle vide, erreur ${code}`}
    >
      <rect width="260" height="170" rx="10" fill="#141B2A" stroke="#2C3850" />
      <path d="M40 130 L70 60 L190 60 L220 130 Z" fill="none" stroke="#2C3850" strokeWidth="1.5" />
      <rect x="95" y="80" width="70" height="26" rx="3" fill="none" stroke="#3B4A66" strokeWidth="1.5" />
      {[80, 100, 160, 180].map((x) => (
        <rect key={x} x={x} y="104" width="14" height="16" rx="2" fill="none" stroke="#3B4A66" />
      ))}
      <rect x="196" y="66" width="18" height="44" rx="2" fill="none" stroke="#2C3850" />
      <text
        x="130"
        y="152"
        textAnchor="middle"
        fill="#5B9BFF"
        fontFamily="ui-monospace, monospace"
        fontSize="22"
        opacity="0.7"
      >
        {code}
      </text>
    </svg>
  );
}

/** U-26 — gabarit partagé des pages 404 et 403. */
export function ErrorPage({ code, title, description, actions }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-10 text-center">
      <EmptyRoom code={code} />
      <h1 className="mt-6 text-2xl font-semibold text-content">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-content-muted">{description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      <Link to="/app/aide" className="mt-4 text-xs text-accent transition hover:text-accent-hover">
        Contacter le support
      </Link>
    </div>
  );
}

export { Button };
