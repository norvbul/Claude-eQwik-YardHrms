import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';
import { About, Copyright, Disclaimer, Licence } from './Legal';

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('public pages (HR-001, HR-003)', () => {
  it('landing page offers Free sign-up and sign-in without inventing plan prices', () => {
    const { container } = inRouter(<Landing />);
    expect(screen.getAllByRole('link', { name: /Start Free/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Sign in/i }).length).toBeGreaterThan(0);
    // Plan prices are an owner decision: nothing like "JMD 5,000 / month" may be hardcoded
    expect(container.textContent).not.toMatch(/(J\$|JMD|US\$|\$)\s?[\d,.]+\s*(\/|per)\s*(mo|month|year|yr|user|employee)/i);
  });

  it.each([
    ['About', About],
    ['Licence', Licence],
    ['Disclaimer', Disclaimer],
    ['Copyright', Copyright],
  ])('%s page carries Qwik Business Solutions attribution', (_name, Page) => {
    const { container } = inRouter(<Page />);
    expect(container.textContent).toMatch(/Qwik Business Solutions/);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('disclaimer states that statutory figures are not certified', () => {
    const { container } = inRouter(<Disclaimer />);
    expect(container.textContent).toMatch(/payroll/i);
  });
});
