import { useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NOW, mergeDateAndTime, toDate } from '../../utils/dates';
import { Button, IconButton } from '../ui/Button';
import { SegmentedControl } from '../ui/Tabs';
import { useIsMobile } from '../../hooks/useMediaQuery';
import './calendar.css';

export const CALENDAR_VIEWS = [
  { value: 'timeGridDay', label: 'Jour' },
  { value: 'timeGridWeek', label: 'Semaine' },
  { value: 'dayGridMonth', label: 'Mois' },
  { value: 'multiMonthYear', label: 'Année' },
];

/**
 * Vues proposées à une largeur donnée : les quatre, à toute largeur.
 *
 * La semaine et l'année étaient retirées sous 768 px, et pour une raison
 * juste : sept colonnes dans 360 px en font 45 chacune — moins qu'un doigt —
 * et douze mois n'y tiennent pas du tout. Elles ne débordaient pas seulement,
 * elles ne rendaient rien de lisible.
 *
 * Ce n'est plus le cas : le calendrier défile désormais dans sa propre boîte,
 * avec une largeur minimale par vue. La semaine y garde des colonnes
 * exploitables et se fait glisser, comme n'importe quel tableau large. Retirer
 * une vue reste un choix à défendre — celui-ci n'a plus de motif, et l'écran
 * de réservation n'offrait plus que deux vues sur quatre au téléphone.
 *
 * La fonction demeure : le paramètre ne sert plus, la vue *par défaut* dépend
 * toujours de la largeur, et c'est une décision distincte de celle-ci.
 */
export const vuesDisponibles = () => CALENDAR_VIEWS;

const LEGEND = [
  { label: 'Libre', className: 'border-line bg-surface-raised' },
  { label: 'Occupé', className: 'border-line-strong bg-[#222C3E]' },
  { label: 'Votre sélection', className: 'border-accent bg-accent/30' },
  { label: 'Fermé', className: 'border-line bg-line/60' },
];

/**
 * Calendrier de disponibilité d'une salle (U-04).
 *
 * Quatre vues : jour et semaine en grille horaire, mois et année en grille de
 * dates. La sélection d'un créneau n'est possible que dans les vues horaires ;
 * dans les vues mois et année, cliquer une date ouvre la journée correspondante.
 */
export function RoomCalendar({
  bookings = [],
  rules,
  anchorDate,
  selection,
  onSelect,
  onRangeChange,
  isLoading,
}) {
  const ref = useRef(null);
  const isMobile = useIsMobile();
  // La semaine au bureau, le jour au téléphone : la vue par défaut suit la
  // largeur au lieu de la contredire.
  const [view, setView] = useState(() => (isMobile ? 'timeGridDay' : 'timeGridWeek'));
  const [title, setTitle] = useState('');

  const visitDays = rules?.visitDays ?? [1, 2, 3, 4, 5];
  const isTimeGrid = view.startsWith('timeGrid');

  const events = useMemo(() => {
    const list = bookings.map((booking) => ({
      id: booking.id,
      title: booking.title,
      start: booking.start,
      end: booking.end,
      editable: false,
    }));

    if (selection?.date && selection?.startTime && selection?.endTime) {
      list.push({
        id: 'selection',
        title: 'Nouvelle réservation',
        start: mergeDateAndTime(selection.date, selection.startTime).toISOString(),
        end: mergeDateAndTime(selection.date, selection.endTime).toISOString(),
        classNames: ['slot-selection'],
      });
    }
    return list;
  }, [bookings, selection]);

  const api = () => ref.current?.getApi();

  const changeView = (next) => {
    setView(next);
    api()?.changeView(next);
  };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Période précédente" onClick={() => api()?.prev()} />
          <span className="min-w-[11rem] text-center text-xs capitalize text-content">
            {title || '—'}
          </span>
          <IconButton icon={ChevronRight} label="Période suivante" onClick={() => api()?.next()} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Vue du calendrier"
            options={vuesDisponibles()}
            value={view}
            onChange={changeView}
          />
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
          plugins={[timeGridPlugin, dayGridPlugin, multiMonthPlugin, interactionPlugin]}
          initialView={isMobile ? 'timeGridDay' : 'timeGridWeek'}
          initialDate={toDate(anchorDate)}
          now={NOW}
          locale={frLocale}
          headerToolbar={false}
          weekends={!isTimeGrid}
          allDaySlot={false}
          nowIndicator
          height="auto"
          expandRows
          dayMaxEvents={3}
          multiMonthMaxColumns={2}
          slotMinTime={rules?.openTime ? `${rules.openTime}:00` : '08:00:00'}
          slotMaxTime={rules?.closeTime ? `${rules.closeTime}:00` : '20:00:00'}
          slotDuration="00:30:00"
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          businessHours={{
            daysOfWeek: visitDays,
            startTime: rules?.openTime ?? '08:00',
            endTime: rules?.closeTime ?? '20:00',
          }}
          selectable={isTimeGrid}
          selectMirror
          selectConstraint="businessHours"
          select={(info) => onSelect?.(info.start, info.end)}
          events={events}
          dayCellClassNames={(arg) => (visitDays.includes(arg.date.getDay()) ? [] : ['fc-day-closed'])}
          dateClick={(info) => {
            // Vues mois et année : le clic sur une date ouvre la journée correspondante.
            if (isTimeGrid) return;
            setView('timeGridDay');
            api()?.changeView('timeGridDay', info.dateStr);
          }}
          datesSet={(info) => {
            setTitle(info.view.title);
            onRangeChange?.({ start: info.start, end: info.end, view: info.view.type });
          }}
          dayHeaderContent={(arg) => {
            const closed = !visitDays.includes(arg.date.getDay());
            return (
              <span className="flex flex-col items-center">
                <span>{arg.text}</span>
                {closed && <span className="text-[9px] uppercase text-content-faint">fermé</span>}
              </span>
            );
          }}
        />
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line px-3 py-2.5">
        {LEGEND.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-xs text-content-muted">
            <span className={`h-2.5 w-2.5 rounded border ${item.className}`} aria-hidden="true" />
            {item.label}
          </span>
        ))}
        {!isTimeGrid && (
          <span className="text-xs text-content-muted">
            Cliquez une date pour ouvrir la journée et choisir un créneau.
          </span>
        )}
      </footer>
    </div>
  );
}
