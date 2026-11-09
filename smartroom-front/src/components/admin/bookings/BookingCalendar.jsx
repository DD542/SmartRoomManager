import { useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import frLocale from '@fullcalendar/core/locales/fr';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { NOW } from '../../../utils/dates';
import { Button, IconButton } from '../../ui/Button';
import { SegmentedControl } from '../../ui/Tabs';
import { SOURCE_META } from './SourceBadge';
import '../../bookings/calendar.css';

/**
 * Une couleur par salle, stable d'un jour à l'autre : la même salle garde sa
 * teinte, qu'on la cherche lundi ou jeudi. Huit teintes assez vives pour se
 * distinguer côte à côte, assez sourdes pour porter du texte une fois fondues
 * dans la surface.
 */
const TEINTES_SALLES = [
  '#4F63D2', // bleu
  '#FF8053', // corail
  '#14A38B', // vert d'eau
  '#E0A100', // ambre
  '#CC3366', // framboise
  '#2E9BD6', // cyan
  '#5BA84F', // vert
  '#7C8BE8', // pervenche
];

/**
 * Attribue les teintes dans l'ordre alphabétique des salles présentes.
 * Une empreinte du nom donnait la même couleur à des salles voisines dans la
 * journée ; ici, deux salles qui se suivent ne partagent jamais leur teinte,
 * et une salle garde la sienne tant que le parc affiché ne change pas.
 */
function teintesParSalle(bookings) {
  const noms = [...new Set(bookings.map((b) => b.room?.name ?? ''))].sort((x, y) =>
    x.localeCompare(y, 'fr'),
  );
  return new Map(noms.map((nom, rang) => [nom, TEINTES_SALLES[rang % TEINTES_SALLES.length]]));
}

/** Fond plein : la teinte fondue dans la surface, et non posée en transparence.
 *  Deux créneaux qui se chevauchent restent ainsi lisibles l'un sur l'autre. */
const fondTeinte = (couleur) => `color-mix(in srgb, ${couleur} 20%, rgb(var(--surface)))`;

const VUES = [
  { value: 'timeGridDay', label: 'Jour' },
  { value: 'timeGridWeek', label: 'Semaine' },
  { value: 'dayGridMonth', label: 'Mois' },
  { value: 'multiMonthYear', label: 'Année' },
];

/**
 * A-03 — vue calendrier de toutes les réservations.
 *
 * Contrairement au calendrier utilisateur, celui-ci couvre toutes les salles :
 * l'événement porte le nom de la salle, et sa couleur est celle de la salle —
 * sans quoi une matinée chargée n'était qu'un empilement de cadres identiques.
 * L'origine de la réservation passe sur un filet épais à gauche.
 *
 * La couleur s'écrivait auparavant `${couleur}2E` : un suffixe d'opacité
 * hexadécimal collé à `rgb(var(--accent))`, ce qui donnait une couleur
 * invalide. Le navigateur l'ignorait, et tous les fonds restaient vides. Aucun créneau n'y est sélectionnable — la création passe
 * par le formulaire, seul endroit où les règles sont vérifiées.
 */
export function BookingCalendar({ bookings = [], onSelect, isLoading }) {
  const ref = useRef(null);
  const compact = useIsMobile();
  const [vue, setVue] = useState(compact ? 'timeGridDay' : 'timeGridWeek');
  const [titre, setTitre] = useState('');

  const evenements = useMemo(() => {
    const actives = bookings.filter((booking) => booking.status !== 'annulee');
    const teintes = teintesParSalle(actives);
    return actives.map((booking) => {
      const teinte = teintes.get(booking.room?.name ?? '');
      return {
        id: booking.id,
        title: `${booking.room?.name ?? ''} — ${booking.title}`,
        start: booking.start,
        end: booking.end,
        editable: false,
        backgroundColor: fondTeinte(teinte),
        borderColor: teinte,
        textColor: 'rgb(var(--content))',
        classNames: [`source-${booking.source ?? 'utilisateur'}`],
      };
    });
  }, [bookings]);

  const api = () => ref.current?.getApi();
  const changerVue = (suivante) => {
    setVue(suivante);
    api()?.changeView(suivante);
  };

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Période précédente" onClick={() => api()?.prev()} />
          <span className="min-w-[11rem] text-center text-xs capitalize text-content">
            {titre || '—'}
          </span>
          <IconButton icon={ChevronRight} label="Période suivante" onClick={() => api()?.next()} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Vue du calendrier" options={VUES} value={vue} onChange={changerVue} />
          <Button variant="secondary" size="sm" onClick={() => api()?.today()}>
            Aujourd’hui
          </Button>
        </div>
      </header>

      <div
        className={`smartroom-calendar px-2 py-2 ${isLoading ? 'opacity-50' : ''}`}
        aria-busy={isLoading}
      >
        <FullCalendar
          ref={ref}
          plugins={[timeGridPlugin, dayGridPlugin, multiMonthPlugin]}
          // La journée au téléphone, la semaine au-delà : sept colonnes dans
          // 360 px ne se lisent pas, et personne n'ouvre un calendrier pour
          // faire défiler une grille illisible.
          initialView={compact ? 'timeGridDay' : 'timeGridWeek'}
          // Sans `initialDate` et `now`, le calendrier s'ouvrirait sur la date
          // système alors que toute la maquette vit au 26 mars 2026.
          initialDate={NOW}
          now={NOW}
          locale={frLocale}
          headerToolbar={false}
          allDaySlot={false}
          nowIndicator
          height="auto"
          expandRows
          dayMaxEvents={3}
          multiMonthMaxColumns={2}
          slotMinTime="08:00:00"
          slotMaxTime="20:00:00"
          slotDuration="00:30:00"
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={evenements}
          eventClick={(info) => {
            const booking = bookings.find((item) => item.id === info.event.id);
            if (booking) onSelect?.(booking);
          }}
          datesSet={(info) => setTitre(info.view.title)}
        />
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line px-3 py-2.5">
        <span className="text-xs font-medium text-content">Une couleur par salle.</span>
        {Object.entries(SOURCE_META).map(([cle, meta]) => (
          <span key={cle} className="flex items-center gap-1.5 text-xs text-content-muted">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm border border-line-strong"
              style={{ borderLeft: `4px solid ${meta.couleur}`, background: 'rgb(var(--surface))' }}
            />
            {meta.label}
          </span>
        ))}
        <span className="text-xs text-content-faint">
          Les réservations annulées ne sont pas affichées.
        </span>
      </footer>
    </div>
  );
}
