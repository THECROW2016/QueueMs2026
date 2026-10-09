import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth';
import { CompleteModal } from '../src/components/CompleteModal';
import { ReasonModal } from '../src/components/ReasonModal';
import { ToastProvider } from '../src/components/ui';
import Login from '../src/pages/Login';
import type { Department, RoutingRule, Ticket } from '../src/lib/types';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
let calls: Array<{ url: string; method: string; body?: unknown }>;

function mockFetch(handler: (url: string, method: string, body: unknown) => Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    return handler(url, init?.method ?? 'GET', body);
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider><ToastProvider>
        <Routes><Route path="/login" element={<Login />} /><Route path="/" element={<p>Signed in home</p>} /></Routes>
      </ToastProvider></AuthProvider>
    </MemoryRouter>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    mockFetch((url, _m, body) => {
      if (url.includes('/auth/me')) return json({ user: null, csrfToken: null });
      if (url.includes('/auth/login')) {
        return (body as { password: string }).password === 'correct-horse-battery'
          ? json({ user: { id: 1, username: 'a', fullName: 'A', email: null, isAdmin: false, roles: [], permissions: [], departmentIds: [], mustChangePassword: false }, csrfToken: 'tok' })
          : json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } }, 401);
      }
      return json({}, 404);
    });
  });

  it('shows validation messages and does not call the server when fields are empty', async () => {
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: /^Login/ }));
    expect(await screen.findByText('Enter your username or email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/auth/login'))).toBe(false);
  });

  it('shows the server error for bad credentials', async () => {
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Username or Email'), 'nurse');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /^Login/ }));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
  });

  it('signs in with valid credentials and moves on', async () => {
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Username or Email'), 'nurse');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /^Login/ }));
    expect(await screen.findByText('Signed in home')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/auth/login'))?.body).toEqual({ username: 'nurse', password: 'correct-horse-battery' });
  });

  it('has no controls that do nothing: no QR login, no role switch', async () => {
    renderLogin();
    await screen.findByLabelText('Username or Email');
    expect(screen.queryByText(/Scan QR/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Admin/ })).toBeNull();
  });
});

describe('ReasonModal', () => {
  it('requires a reason and only confirms once one is given', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ReasonModal title="Cancel ticket" confirmLabel="Cancel ticket" onClose={onClose} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }));
    expect(await screen.findByText(/Please give a short reason/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Patient left');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Patient left'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CompleteModal', () => {
  const dept = (id: number, name: string): Department => ({ id, code: name.toUpperCase(), name, ticketPrefix: name[0]!, sortOrder: id, isActive: true, isClinical: true, sequencePolicy: 'DAILY', workflowStages: [], serviceTypes: [] });
  const rule = (id: number, to: number, toName: string, extra: Partial<RoutingRule> = {}): RoutingRule => ({ id, fromDepartmentId: 3, toDepartmentId: to, isActive: true, requiresReason: false, emergencyOnly: false, from: { id: 3, name: 'Consultation', code: 'CONSULTATION' }, to: { id: to, name: toName, code: toName.toUpperCase() }, ...extra });
  const ticket = { id: 9, displayNumber: 'C-001', department: { id: 3, name: 'Consultation', code: 'CONSULTATION' } } as Ticket;

  it('lists only allowed onward departments and enforces required reasons', async () => {
    mockFetch(() => json({}));
    const rules = [rule(1, 4, 'Laboratory'), rule(2, 5, 'Radiology', { requiresReason: true }), rule(3, 6, 'Isolation', { emergencyOnly: true }), rule(4, 7, 'Closed', { isActive: false })];
    render(<ToastProvider><CompleteModal ticket={ticket} rules={rules} departments={[dept(4, 'Laboratory'), dept(5, 'Radiology')]} canPrioritise={false} canEmergency={false} onClose={() => undefined} onDone={() => undefined} /></ToastProvider>);
    expect(screen.getByRole('checkbox', { name: /Laboratory/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Isolation/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Closed/ })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: /Radiology/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Complete and route' }));
    expect(await screen.findByText(/A reason is required to send the patient to Radiology/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/complete'))).toBe(false);

    await userEvent.type(screen.getByLabelText(/Reason \(required\)/), 'Chest pain work-up');
    await userEvent.click(screen.getByRole('button', { name: 'Complete and route' }));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/tickets/9/complete'))?.body).toEqual({ next: [{ departmentId: 5, reason: 'Chest pain work-up' }] }));
  });
});
