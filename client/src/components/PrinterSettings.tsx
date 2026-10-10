import { PAPERS, type PaperId, type PrintSettings } from '../lib/printSettings';

interface Props { settings: PrintSettings; onChange: (patch: Partial<PrintSettings>) => void; onReset: () => void }

export function PrinterSettings({ settings, onChange, onReset }: Props) {
  const check = (id: string, label: string, key: 'autoPrint' | 'showDate' | 'showAhead' | 'showInstructions') => (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" checked={settings[key]} onChange={(e) => onChange({ [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <section aria-label="Printer settings" className="card space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="ps-paper">Paper</label>
          <select id="ps-paper" className="input" value={settings.paper} onChange={(e) => onChange({ paper: e.target.value as PaperId })}>
            {(Object.keys(PAPERS) as PaperId[]).map((id) => <option key={id} value={id}>{PAPERS[id].label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ps-text">Text size</label>
          <select id="ps-text" className="input" value={settings.textSize} onChange={(e) => onChange({ textSize: e.target.value as PrintSettings['textSize'] })}>
            <option value="normal">Normal</option><option value="large">Large</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ps-copies">Copies per ticket</label>
          <select id="ps-copies" className="input" value={settings.copies} onChange={(e) => onChange({ copies: Number(e.target.value) as PrintSettings['copies'] })}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">On the ticket</legend>
        {check('ps-date', 'Date and time', 'showDate')}
        {check('ps-ahead', 'People ahead of you', 'showAhead')}
        {check('ps-instr', 'Waiting-room instructions', 'showInstructions')}
      </fieldset>
      <div className="space-y-2">
        {check('ps-auto', 'Open the print dialog automatically after registering a visit', 'autoPrint')}
        <p className="text-xs text-slate-500">
          These settings are saved on this computer only. The printer itself is chosen in the print dialog, or set as the computer&apos;s default printer.
          For one-click printing with no dialog, start Chrome or Edge with the <code>--kiosk-printing</code> option; it then prints to the default printer.
        </p>
      </div>
      <div><button type="button" className="btn-secondary btn-sm" onClick={onReset}>Restore defaults</button></div>
    </section>
  );
}
