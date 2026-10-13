import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@yardhrms/ui';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ me: null, mfaPending: false }) }));

import { Login } from './Auth';

function renderLogin() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/mfa" element={<p>MFA step</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Licence Manager staff sign-in', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('validates on the client and does not call the API with an invalid form', async () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(post).not.toHaveBeenCalled();
  });

  it('posts credentials to the platform login and always continues to the MFA step', async () => {
    post.mockResolvedValue({});
    renderLogin();
    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'officer@qwik.example' } });
    fireEvent.input(screen.getByLabelText(/Password/), { target: { value: 'Str0ng!Passw0rd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('MFA step')).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/platform/auth/login', { email: 'officer@qwik.example', password: 'Str0ng!Passw0rd' });
  });

  it('shows the server error message on failed sign-in', async () => {
    post.mockImplementation(async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Email or password is incorrect');
    });
    renderLogin();
    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'officer@qwik.example' } });
    fireEvent.input(screen.getByLabelText(/Password/), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Email or password is incorrect')).toBeTruthy());
  });
});
