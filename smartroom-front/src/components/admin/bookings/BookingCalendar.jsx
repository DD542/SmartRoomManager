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
 * l'événement porte donc le nom de la salle, et sa couleur rappelle l'origine
 * de la réservation. Aucun créneau n'y est sélectionnable — la création passe
 * par le formulaire, seul endroit où les règles sont vérifiées.
 */
export function BookingCalendar({ bookings = [], onSelect, isLoading }) {
  const ref = useRef(null);
  const compact = useIsMobile();
  const [vue, setVue] = useState(compact ? 'timeGridDay' : 'timeGridWeek');
  const [titre, setTitre] = useState('');

  const evenements = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status !== 'annulee')
        .map((booking) => {
          const meta = SOURCE_META[booking.source] ?? SOURCE_META.utilisateur;
          return {
            id: booking.id,
            title: `${booking.room?.name ?? ''} — ${booking.title}`,
            start: booking.start,
            end: booking.end,
            editable: false,
            backgroundColor: `${meta.couleur}2E`,
            borderColor: meta.couleur,
            textColor: '#F7FAFF',
          };
        }),
    [bookings],
  );

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
        {Object.entries(SOURCE_META).map(([cle, meta]) => (
          <span key={cle} className="flex items-center gap-1.5 text-xs text-content-muted">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded border"
              style={{ background: `${meta.couleur}2E`, borderColor: meta.couleur }}
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
