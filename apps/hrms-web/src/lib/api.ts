import { createApiClient } from '@yardhrms/ui';

let csrfToken: string | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}

/** Single API client for the HRMS: same-origin /api/v1 (proxied by Vite in development). */
export const api = createApiClient({
  base: '/api/v1',
  getCsrf: () => csrfToken,
});
