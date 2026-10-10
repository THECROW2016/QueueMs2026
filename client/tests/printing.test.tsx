import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintableSlip } from '../src/components/PrintableSlip';
import { DEFAULT_PRINT_SETTINGS, loadPrintSettings, parsePrintSettings, savePrintSettings } from '../src/lib/printSettings';
import TicketSlip from '../src/pages/TicketSlip';

const slip = { hospitalName: 'Test Hospital', displayNumber: 'R-014', departmentName: 'Reception', issuedAt: '2026-10-10T07:00:00.000Z', peopleAhead: 3, instructions: 'Listen for your number.' };

beforeEach(() => window.localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('print settings storage', () => {
  it('falls back to defaults for missing, corrupt or invalid values', () => {
    expect(parsePrintSettings(null)).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(parsePrintSettings('not json')).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(parsePrintSettings('{"paper":"huge","copies":9,"autoPrint":"yes"}')).toEqual(DEFAULT_PRINT_SETTINGS);
  });
  it('round-trips saved settings', () => {
    const s = { ...DEFAULT_PRINT_SETTINGS, paper: '58mm' as const, copies: 2 as const, autoPrint: true, showDate: false };
    expect(savePrintSettings(s)).toBe(true);
    expect(loadPrintSettings()).toEqual(s);
  });
  it('still works when browser storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(savePrintSettings(DEFAULT_PRINT_SETTINGS)).toBe(false);
  });
});

describe('PrintableSlip', () => {
  it('sets the page size for the chosen paper and repeats the slip per copy', () => {
    const { container } = render(<PrintableSlip slip={slip} settings={{ ...DEFAULT_PRINT_SETTINGS, paper: '58mm', copies: 3 }} />);
    expect(container.querySelector('style')?.textContent).toContain('size: 58mm 95mm');
    expect(screen.getAllByTestId('slip-copy')).toHaveLength(3);
    expect(screen.getAllByText('R-014')).toHaveLength(3);
  });
  it('hides optional lines when switched off and never shows personal data fields', () => {
    render(<PrintableSlip slip={slip} settings={{ ...DEFAULT_PRINT_SETTINGS, showAhead: false, showInstructions: false, showDate: false }} />);
    expect(screen.queryByText(/ahead of you/)).toBeNull();
    expect(screen.queryByText('Listen for your number.')).toBeNull();
    expect(screen.getByText('Reception')).toBeInTheDocument();
  });
});

function renderSlipPage(state?: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(slip), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/tickets/5/slip', state }]}>
      <Routes><Route path="/tickets/:ticketId/slip" element={<TicketSlip />} /></Routes>
    </MemoryRouter>,
  );
}

describe('TicketSlip page', () => {
  it('prints on request, and saves settings changed in the panel', async () => {
    const print = vi.fn(); vi.stubGlobal('print', print);
    const user = userEvent.setup();
    renderSlipPage();
    await screen.findByTestId('slip-number');
    await user.click(screen.getByRole('button', { name: 'Printer settings' }));
    await user.selectOptions(screen.getByLabelText('Paper'), '58mm');
    await user.selectOptions(screen.getByLabelText('Copies per ticket'), '2');
    expect(loadPrintSettings()).toMatchObject({ paper: '58mm', copies: 2 });
    expect(screen.getAllByTestId('slip-copy')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Print ticket \(2 copies\)/ }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('auto-prints once after registration when enabled', async () => {
    const print = vi.fn(); vi.stubGlobal('print', print);
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, autoPrint: true });
    renderSlipPage({ issued: true });
    await screen.findByTestId('slip-number');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it('does not auto-print when reopening a slip or when auto-print is off', async () => {
    const print = vi.fn(); vi.stubGlobal('print', print);
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, autoPrint: true });
    const first = renderSlipPage(undefined);
    await screen.findByTestId('slip-number');
    first.unmount();
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, autoPrint: false });
    renderSlipPage({ issued: true });
    await screen.findByTestId('slip-number');
    await new Promise((r) => setTimeout(r, 500));
    expect(print).not.toHaveBeenCalled();
  });
});
