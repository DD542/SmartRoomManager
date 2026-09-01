import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CalendarCheck, CheckCheck, Clock, LifeBuoy } from 'lucide-react';
import { listNotifications, listTabs, markAllAsRead, markAsRead } from '../../api/notifications';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { dayBucket, fmtRelative } from '../../utils/dates';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { AsyncBoundary, EmptyState, Skeleton } from '../../components/ui/States';
import { StaggerList } from '../../components/ui/StaggerList';
import { PageHeader } from '../../components/layout/PageHeader';

const ICONS = {
  reservation: { icon: CalendarCheck, tone: 'text-accent' },
  rappel: { icon: Clock, tone: 'text-warning' },
  aide: { icon: LifeBuoy, tone: 'text-success' },
  conflit: { icon: AlertTriangle, tone: 'text-danger' },
};

/** U-20 — Notifications, groupées par jour, non lues signalées par un point. */
export default function NotificationsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('toutes');

  useEffect(() => {
    document.title = 'Notifications — SmartRoom Manager';
  }, []);

  const tabs = useAsync(listTabs, []);
  const notifications = useAsync(() => listNotifications(tab), [tab]);

  const groups = useMemo(() => {
    const list = notifications.data ?? [];
    return list.reduce((acc, notification) => {
      const key = dayBucket(notification.at);
      return { ...acc, [key]: [...(acc[key] ?? []), notification] };
    }, {});
  }, [notifications.data]);

  const open = async (notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
      notifications.reload();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notifications"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={CheckCheck}
            onClick={async () => {
              await markAllAsRead();
              notifications.reload();
              toast.success('Notifications marquées comme lues');
            }}
          >
            Tout marquer comme lu
          </Button>
        }
      />

      <Card>
        <Tabs
          tabs={tabs.data ?? [{ id: 'toutes', label: 'Toutes' }]}
          value={tab}
          onChange={setTab}
          label="Catégories de notifications"
          className="px-2"
        />

        <AsyncBoundary
          status={notifications.status}
          error={notifications.error}
          onRetry={notifications.reload}
          isEmpty={notifications.isSuccess && (notifications.data ?? []).length === 0}
          skeleton={
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          }
          empty={
            <EmptyState
              icon={Bell}
              title="Aucune notification"
              description="Les rappels et confirmations arriveront ici."
            />
          }
        >
          <div className="flex flex-col gap-5 p-4">
            {Object.entries(groups).map(([day, items]) => (
              <section key={day}>
                <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">{day}</h2>
                <StaggerList className="mt-2 flex flex-col gap-2">
                  {items.map((notification) => {
                    const { icon: Icon, tone } = ICONS[notification.category] ?? ICONS.reservation;
                    return (
                      <article
                        key={notification.id}
                        onMouseEnter={() => open(notification)}
                        className={`flex gap-3 rounded-xl border bg-surface-raised px-3 py-3 transition ${
                          notification.read ? 'border-line' : 'border-l-2 border-l-accent border-line'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
                          <Icon size={15} aria-hidden="true" className={tone} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-sm font-medium text-content">{notification.title}</h3>
                            <span className="flex items-center gap-2 text-xs text-content-muted">
                              {fmtRelative(notification.at)}
                              {!notification.read && (
                                <>
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                                  <span className="sr-only">Non lue</span>
                                </>
                              )}
                            </span>
                          </div>
                          {/* Le corps est recopié du courriel : il porte des
                              paragraphes séparés par des sauts de ligne, et un
                              lien de soixante caractères. Sans `break-words`,
                              cette URL insecable sortait de la carte — 11
                              cartes sur 14 débordaient de 54 à 64 px à 375 px.
                              Sans `whitespace-pre-line`, « Bonjour Dylan, »
                              se recollait à la phrase suivante. */}
                          <p className="mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed text-content-muted">
                            {notification.body}
                          </p>
                          {notification.action && (
                            <Link
                              to={notification.action.to}
                              onClick={() => open(notification)}
                              className="mt-2 inline-flex rounded-lg border border-line bg-surface px-2 py-1 text-xs text-content transition hover:border-accent"
                            >
                              {notification.action.label}
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </StaggerList>
              </section>
            ))}
          </div>
        </AsyncBoundary>
      </Card>
    </div>
  );
}
