import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { dailyReport, departmentReport, exportReportCsv, liveDashboard, summaryReport, type ReportQuery } from '../services/reports.service.js';
import { dateKey, id, parse } from '../validators/common.js';
import { ah } from '../utils/misc.js';
import { localDateKey } from '../utils/time.js';

export const reportRoutes = Router();

const bool = z.enum(['true', 'false']).optional().transform((v) => v === 'true');
const query = z.object({ from: dateKey.optional(), to: dateKey.optional(), departmentId: id.optional(), includeCancelled: bool, includeTest: bool });
const toQuery = (raw: unknown): ReportQuery => {
  const q = parse(query, raw);
  const today = localDateKey();
  return { from: q.from ?? q.to ?? today, to: q.to ?? q.from ?? today, departmentId: q.departmentId, includeCancelled: q.includeCancelled, includeTest: q.includeTest };
};

reportRoutes.get('/dashboard', requirePermission('dashboard.admin'), ah(async (_req, res) => { res.json(await liveDashboard()); }));
reportRoutes.get('/reports/summary', requirePermission('reports.view'), ah(async (req, res) => { res.json(await summaryReport(toQuery(req.query))); }));
reportRoutes.get('/reports/departments', requirePermission('reports.view'), ah(async (req, res) => { res.json({ rows: await departmentReport(toQuery(req.query)) }); }));
reportRoutes.get('/reports/daily', requirePermission('reports.view'), ah(async (req, res) => { res.json({ rows: await dailyReport(toQuery(req.query)) }); }));
reportRoutes.get('/reports/export', requirePermission('reports.export'), ah(async (req, res) => {
  const kind = parse(z.object({ report: z.enum(['departments', 'daily', 'longest-waits']).default('departments') }), req.query).report;
  const q = toQuery(req.query);
  const csv = await exportReportCsv(req.auth!.user, kind, q, req);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hqms-${kind}-${q.from}_${q.to}.csv"`, 'Cache-Control': 'no-store' });
  res.send(`﻿${csv}`);
}));
