import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Field, Input, StatusBadge } from './primitives';
import { formatMoney, formatDate, titleCase } from './format';
import { ApiError, createApiClient } from './api';

describe('format helpers', () => {
  it('formats decimal strings as JMD without float conversion', () => {
    expect(formatMoney('1234567.5')).toBe('JMD 1,234,567.50');
    expect(formatMoney('-0.1', '')).toBe('-0.10');
    expect(formatMoney(null)).toBe('—');
  });
  it('formats ISO dates in UTC and title-cases enums', () => {
    expect(formatDate('2026-08-06')).toMatch(/2026/);
    expect(titleCase('PENDING_ACTIVATION')).toBe('Pending Activation');
  });
});

describe('components', () => {
  it('Field associates label and error with its control', () => {
    render(<Field label="Email" error="Required">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
  it('Button shows loading state and is disabled', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
  it('StatusBadge humanizes statuses', () => {
    render(<StatusBadge status="PENDING_ACTIVATION" />);
    expect(screen.getByText('Pending activation')).toBeInTheDocument();
  });
});

describe('api client', () => {
  it('sends CSRF on writes and raises structured ApiError', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'CAPACITY_EXCEEDED', message: 'Limit reached', details: { fieldErrors: [{ path: 'x', message: 'bad' }] } } }), { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ base: '/api/v1', getCsrf: () => 'tok' });
    await expect(api.post('/employees', {})).rejects.toBeInstanceOf(ApiError);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(init.credentials).toBe('include');
    try {
      await api.post('/employees', {});
    } catch (e) {
      expect((e as ApiError).code).toBe('CAPACITY_EXCEEDED');
      expect((e as ApiError).fieldErrors).toEqual({ x: 'bad' });
    }
    vi.unstubAllGlobals();
  });
});
