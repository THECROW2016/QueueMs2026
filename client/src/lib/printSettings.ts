import { useCallback, useState } from 'react';

/** Printer settings are per workstation (each reception desk has its own printer), so they live in this browser only. */
export type PaperId = '58mm' | '80mm' | 'a6' | 'a4';
export type TextSize = 'normal' | 'large';

export interface PrintSettings {
  paper: PaperId;
  textSize: TextSize;
  copies: 1 | 2 | 3;
  /** Open the print dialog straight after a visit is registered. */
  autoPrint: boolean;
  showDate: boolean;
  showAhead: boolean;
  showInstructions: boolean;
}

export interface PaperSpec { label: string; width: string; height: string; numberPx: number; basePx: number; padPx: number }

export const PAPERS: Record<PaperId, PaperSpec> = {
  '58mm': { label: '58 mm thermal roll', width: '58mm', height: '95mm', numberPx: 44, basePx: 11, padPx: 8 },
  '80mm': { label: '80 mm thermal roll', width: '80mm', height: '110mm', numberPx: 60, basePx: 13, padPx: 12 },
  a6: { label: 'A6 sheet (105 × 148 mm)', width: '105mm', height: '148mm', numberPx: 84, basePx: 16, padPx: 20 },
  a4: { label: 'A4 sheet (210 × 297 mm)', width: '210mm', height: '297mm', numberPx: 150, basePx: 22, padPx: 40 },
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: '80mm', textSize: 'normal', copies: 1, autoPrint: false, showDate: true, showAhead: true, showInstructions: true,
};

const KEY = 'hqms.printSettings.v1';

/** Reads stored settings, ignoring anything missing or invalid so a bad value can never break printing. */
export function parsePrintSettings(raw: string | null): PrintSettings {
  if (!raw) return { ...DEFAULT_PRINT_SETTINGS };
  let v: Partial<Record<keyof PrintSettings, unknown>>;
  try { v = JSON.parse(raw) as typeof v; } catch { return { ...DEFAULT_PRINT_SETTINGS }; }
  if (!v || typeof v !== 'object') return { ...DEFAULT_PRINT_SETTINGS };
  const d = DEFAULT_PRINT_SETTINGS;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  return {
    paper: typeof v.paper === 'string' && v.paper in PAPERS ? (v.paper as PaperId) : d.paper,
    textSize: v.textSize === 'large' ? 'large' : 'normal',
    copies: v.copies === 2 || v.copies === 3 ? v.copies : 1,
    autoPrint: bool(v.autoPrint, d.autoPrint),
    showDate: bool(v.showDate, d.showDate),
    showAhead: bool(v.showAhead, d.showAhead),
    showInstructions: bool(v.showInstructions, d.showInstructions),
  };
}

export function loadPrintSettings(): PrintSettings {
  try { return parsePrintSettings(window.localStorage.getItem(KEY)); } catch { return { ...DEFAULT_PRINT_SETTINGS }; }
}

export function savePrintSettings(s: PrintSettings): boolean {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function usePrintSettings(): [PrintSettings, (patch: Partial<PrintSettings>) => void, () => void] {
  const [settings, setSettings] = useState<PrintSettings>(loadPrintSettings);
  const update = useCallback((patch: Partial<PrintSettings>) => {
    setSettings((prev) => { const next = { ...prev, ...patch }; savePrintSettings(next); return next; });
  }, []);
  const reset = useCallback(() => { setSettings({ ...DEFAULT_PRINT_SETTINGS }); savePrintSettings(DEFAULT_PRINT_SETTINGS); }, []);
  return [settings, update, reset];
}
