import { dateTime } from '../lib/format';
import { PAPERS, type PrintSettings } from '../lib/printSettings';

export interface SlipData { hospitalName: string; displayNumber: string; departmentName: string; issuedAt: string; peopleAhead: number; instructions: string }

/**
 * The ticket as it appears on screen and on paper. It carries no personal or medical information.
 * Sets the page size for the print dialog and repeats the slip once per requested copy (one per page, so a thermal cutter separates them).
 */
export function PrintableSlip({ slip, settings }: { slip: SlipData; settings: PrintSettings }) {
  const paper = PAPERS[settings.paper];
  const scale = settings.textSize === 'large' ? 1.2 : 1;
  const base = Math.round(paper.basePx * scale);
  return (
    <>
      <style>{`@page { size: ${paper.width} ${paper.height}; margin: 0; }`}</style>
      <div className="print-area mx-auto" style={{ width: paper.width, maxWidth: '100%' }}>
        {Array.from({ length: settings.copies }, (_, i) => (
          <div
            key={i}
            data-testid="slip-copy"
            className={`card text-center print:rounded-none print:border-0 ${i > 0 ? 'hidden print:block' : ''}`}
            style={{ padding: paper.padPx, fontSize: base, breakAfter: i < settings.copies - 1 ? 'page' : 'auto' }}
          >
            <p className="font-semibold uppercase tracking-wide text-slate-600" style={{ fontSize: base }}>{slip.hospitalName}</p>
            <p className="text-slate-500" style={{ marginTop: base, fontSize: base * 0.9 }}>Your number</p>
            <p className="font-extrabold leading-none tracking-tight" style={{ fontSize: Math.round(paper.numberPx * scale), marginTop: base * 0.4 }} data-testid={i === 0 ? 'slip-number' : undefined}>{slip.displayNumber}</p>
            <p className="font-semibold" style={{ marginTop: base * 0.6, fontSize: base * 1.25 }}>{slip.departmentName}</p>
            {settings.showAhead && <p className="text-slate-600" style={{ marginTop: base * 0.3 }}>{slip.peopleAhead} {slip.peopleAhead === 1 ? 'person' : 'people'} ahead of you</p>}
            {settings.showDate && <p className="text-slate-500" style={{ marginTop: base * 0.5, fontSize: base * 0.85 }}>{dateTime(slip.issuedAt)}</p>}
            {settings.showInstructions && slip.instructions && <p className="border-t border-dashed border-slate-300 text-slate-600" style={{ marginTop: base, paddingTop: base * 0.6, fontSize: base * 0.85 }}>{slip.instructions}</p>}
          </div>
        ))}
      </div>
    </>
  );
}
