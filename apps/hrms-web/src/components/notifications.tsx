import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardBody, CardHeader, Checkbox, Spinner, cn, errorMessage, formatDateTime, useToast } from '@yardhrms/ui';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface Item {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Header bell: unread count (polled every minute) and the latest notifications. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getPage<Item>('/notifications') as Promise<{ items: Item[]; meta: { unread?: number } }>,
    refetchInterval: 60_000,
  });
  const unread = q.data?.meta.unread ?? 0;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const openItem = async (n: Item) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    setOpen(false);
    if (n.link) navigate(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </Button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                onClick={async () => {
                  await api.post('/notifications/read-all');
                  await qc.invalidateQueries({ queryKey: ['notifications'] });
                }}
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {q.isLoading ? (
              <div className="grid place-items-center p-6"><Spinner /></div>
            ) : !q.data?.items.length ? (
              <p className="p-6 text-center text-sm text-slate-500">You’re all caught up.</p>
            ) : (
              q.data.items.map((n) => (
                <button key={n.id} onClick={() => openItem(n)} className={cn('block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-brand/5')}>
                  <p className={cn('text-sm', !n.readAt ? 'font-semibold text-slate-900' : 'text-slate-700')}>{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Account page: which notifications are also emailed. */
export function NotificationPreferences() {
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<{ key: string; label: string; mandatory: boolean; email: boolean }[]>('/notifications/preferences') });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  return (
    <Card>
      <CardHeader title="Notifications" description="Everything appears in the bell menu. Choose what is also sent to your email." />
      <CardBody className="space-y-3">
        {q.data?.map((p) => (
          <Checkbox
            key={p.key}
            label={`${p.label}${p.mandatory ? ' (always on)' : ''}`}
            checked={p.email}
            disabled={p.mandatory || busy === p.key}
            onChange={async (e) => {
              setBusy(p.key);
              try {
                await api.put('/notifications/preferences', { email: { [p.key]: e.target.checked } });
                await qc.invalidateQueries({ queryKey: ['notification-prefs'] });
              } catch (x) {
                toast.error('Could not save', errorMessage(x));
              } finally {
                setBusy(null);
              }
            }}
          />
        ))}
      </CardBody>
    </Card>
  );
}
