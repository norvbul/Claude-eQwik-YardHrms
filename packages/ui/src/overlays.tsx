import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, cn } from './primitives';

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    const first = focusables()[0];
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const modalSizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', modalSizes[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, description, children, footer }: Omit<ModalProps, 'size'>) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** When set, the user must type a reason (min 3 chars) which is passed to onConfirm. */
  requireReason?: string;
}

export function ConfirmDialog({ open, options, onCancel, onConfirm, busy }: { open: boolean; options: ConfirmOptions | null; onCancel: () => void; onConfirm: (reason?: string) => void; busy?: boolean }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  if (!options) return null;
  const needsReason = !!options.requireReason;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={options.title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={options.tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={needsReason && reason.trim().length < 3} onClick={() => onConfirm(needsReason ? reason.trim() : undefined)}>
            {options.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 flex-none', options.tone === 'danger' ? 'text-red-600' : 'text-amber-500')} aria-hidden />
        <div className="space-y-3 text-sm text-slate-600">
          <div>{options.message}</div>
          {needsReason && (
            <label className="block">
              <span className="mb-1 block font-medium text-slate-700">{options.requireReason}</span>
              <textarea
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Imperative confirm helper: `const confirm = useConfirm(); if (await confirm({...})) …` */
export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used inside <FeedbackProvider>');
  return ctx;
}

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

const ToastCtx = createContext<{ push: (kind: ToastKind, title: string, message?: string) => void } | null>(null);
const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<{ ok: boolean; reason?: string }>) | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (v: { ok: boolean; reason?: string }) => void } | null>(null);
  const push = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, kind, title, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<{ ok: boolean; reason?: string }>((resolve) => setConfirmState({ options, resolve })), []);
  const toastValue = useMemo(() => ({ push }), [push]);
  const icons = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <ToastCtx.Provider value={toastValue}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <ConfirmDialog
          open={!!confirmState}
          options={confirmState?.options ?? null}
          onCancel={() => {
            confirmState?.resolve({ ok: false });
            setConfirmState(null);
          }}
          onConfirm={(reason) => {
            confirmState?.resolve({ ok: true, reason });
            setConfirmState(null);
          }}
        />
        <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
          {toasts.map((t) => {
            const Icon = icons[t.kind];
            return (
              <div
                key={t.id}
                role={t.kind === 'error' ? 'alert' : 'status'}
                className={cn(
                  'pointer-events-auto flex gap-3 rounded-xl border bg-white p-3 shadow-lg',
                  t.kind === 'success' && 'border-emerald-200',
                  t.kind === 'error' && 'border-red-200',
                  t.kind === 'info' && 'border-sky-200',
                )}
              >
                <Icon className={cn('mt-0.5 h-5 w-5 flex-none', t.kind === 'success' ? 'text-emerald-600' : t.kind === 'error' ? 'text-red-600' : 'text-sky-600')} aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">{t.title}</p>
                  {t.message && <p className="mt-0.5 break-words text-slate-600">{t.message}</p>}
                </div>
                <button className="ml-auto text-slate-400 hover:text-slate-600" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <FeedbackProvider>');
  return {
    success: (title: string, message?: string) => ctx.push('success', title, message),
    error: (title: string, message?: string) => ctx.push('error', title, message),
    info: (title: string, message?: string) => ctx.push('info', title, message),
  };
}
