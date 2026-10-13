/** Error thrown for non-2xx API responses, carrying the structured error body. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public requestId?: string,
  ) {
    super(message);
  }

  /** Field-level validation messages keyed by dotted path (for react-hook-form setError). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of (this.details?.fieldErrors ?? []) as { path: string; message: string }[]) if (!out[f.path]) out[f.path] = f.message;
    return out;
  }
}

export interface ApiClientOptions {
  base: string;
  getCsrf: () => string | null;
  onUnauthenticated?: (err: ApiError) => void;
}

export interface ApiClient {
  get<T>(path: string, params?: Record<string, unknown>): Promise<T>;
  getPage<T>(path: string, params?: Record<string, unknown>): Promise<{ items: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  upload<T>(path: string, file: File, fields?: Record<string, string>): Promise<T>;
  download(path: string, opts?: { method?: 'GET' | 'POST'; fileName?: string; open?: boolean }): Promise<{ headers: Headers }>;
  url(path: string, params?: Record<string, unknown>): string;
}

function qs(params?: Record<string, unknown>) {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Fetch wrapper: cookie credentials, CSRF header on writes, structured error parsing. */
export function createApiClient(opts: ApiClientOptions): ApiClient {
  const url = (path: string, params?: Record<string, unknown>) => `${opts.base}${path}${qs(params)}`;

  async function raw(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { Accept: 'application/json', ...headers };
    if (method !== 'GET') {
      const csrf = opts.getCsrf();
      if (csrf) h['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(url(path), { method, credentials: 'include', headers: h, body: body ?? undefined });
    if (!res.ok) {
      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        /* non-JSON */
      }
      const e = payload?.error;
      const err = new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? res.statusText ?? 'Request failed', e?.details, e?.requestId);
      if (res.status === 401) opts.onUnauthenticated?.(err);
      throw err;
    }
    return res;
  }

  async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await raw(method, path, body === undefined ? (method === 'GET' ? null : '{}') : JSON.stringify(body), method === 'GET' ? {} : { 'Content-Type': 'application/json' });
    const data = await res.json();
    return data.data as T;
  }

  return {
    url,
    get: (path, params) => json('GET', `${path}${qs(params)}`),
    async getPage(path, params) {
      const res = await raw('GET', `${path}${qs(params)}`);
      const body = await res.json();
      return { items: body.data, meta: body.meta };
    },
    post: (path, body) => json('POST', path, body),
    patch: (path, body) => json('PATCH', path, body),
    put: (path, body) => json('PUT', path, body),
    del: (path, body) => json('DELETE', path, body),
    async upload(path, file, fields) {
      const fd = new FormData();
      fd.append('file', file);
      for (const [k, v] of Object.entries(fields ?? {})) fd.append(k, v);
      const res = await raw('POST', path, fd);
      return (await res.json()).data;
    },
    async download(path, o = {}) {
      const res = await raw(o.method ?? 'GET', path, o.method === 'POST' ? '{}' : null, o.method === 'POST' ? { 'Content-Type': 'application/json' } : {});
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const name = o.fileName ?? /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download';
      const href = URL.createObjectURL(blob);
      if (o.open) {
        const w = window.open(href, '_blank', 'noopener');
        if (!w) window.location.href = href;
      } else {
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      return { headers: res.headers };
    },
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
