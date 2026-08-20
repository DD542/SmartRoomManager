import { useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NOW, fmtTime, toDate } from '../../utils/dates';
import { Button, IconButton } from '../ui/Button';
import './calendar.css';

const TONE = {
  confirmee: { bg: 'rgba(61,219,166,0.16)', border: '#3DDBA6' },
  en_attente: { bg: 'rgba(252,198,63,0.16)', border: '#FCC63F' },
  annulee: { bg: 'rgba(255,128,128,0.16)', border: '#FF8080' },
  terminee: { bg: 'rgba(44,56,80,0.9)', border: '#3B4A66' },
};

const LEGEND = [
  { label: 'Confirmé', tone: 'confirmee' },
  { label: 'En attente', tone: 'en_attente' },
  { label: 'Annulé', tone: 'annulee' },
];

/** U-08 — grille mensuelle des réservations (FullCalendar dayGrid). */
export function MonthCalendar({
  bookings = [],
  monthLabel,
  anchorDate,
  onSelectDay,
  onNavigate,
  isLoading,
}) {
  const ref = useRef(null);

  const events = bookings.map((booking) => ({
    id: booking.id,
    title: `${fmtTime(booking.start)} ${booking.room?.name ?? ''}`,
    start: booking.start,
    end: booking.end,
    backgroundColor: (TONE[booking.status] ?? TONE.terminee).bg,
    borderColor: (TONE[booking.status] ?? TONE.terminee).border,
    textColor: '#F7FAFF',
    extendedProps: { status: booking.status },
  }));

  const go = (direction) => {
    const api = ref.current?.getApi();
    if (!api) return;
    if (direction === 'prev') api.prev();
    if (direction === 'next') api.next();
    if (direction === 'today') api.today();
    onNavigate?.(api.getDate());
  };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Mois précédent" onClick={() => go('prev')} />
          <span className="min-w-[9rem] text-center text-sm capitalize text-content">{monthLabel}</span>
          <IconButton icon={ChevronRight} label="Mois suivant" onClick={() => go('next')} />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => go('today')}>
            Aujourd’hui
          </Button>
          {LEGEND.map((item) => (
            <span key={item.tone} className="hidden items-center gap-1.5 text-xs text-content-muted sm:flex">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: TONE[item.tone].border }}
                aria-hidden="true"
              />
              {item.label}
            </span>
          ))}
        </div>
      </header>

      <div className={`smartroom-calendar p-2 ${isLoading ? 'opacity-50' : ''}`} aria-busy={isLoading}>
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={toDate(anchorDate ?? NOW)}
          // L'application vit sur l'horloge de référence, pas sur celle du poste.
          now={NOW}
          locale={frLocale}
          headerToolbar={false}
          height="auto"
          fixedWeekCount={false}
          dayMaxEvents={3}
          events={events}
          eventDisplay="block"
          dateClick={(info) => onSelectDay?.(info.date)}
          eventClick={(info) => {
            info.jsEvent.preventDefault();
            onSelectDay?.(toDate(info.event.start));
          }}
          datesSet={(info) => onNavigate?.(info.view.currentStart)}
        />
      </div>
    </div>
  );
}
