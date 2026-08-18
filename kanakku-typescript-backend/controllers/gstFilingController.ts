import type { Request, Response } from 'express';

import { gstr1 as gstr1Handler, gstr3b as gstr3bHandler } from './taxReportsController';

// Wrap the existing report handlers' computed payloads into JSON or CSV download responses.
// Re-fetch via the controller fns by constructing fake response objects, then convert.

interface CapturedResponse {
  status: number;
  body: unknown;
}

function captureResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 200, body: null };
  const fakeRes = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  };
  return { res: fakeRes as unknown as Response, captured };
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function gstr1ToCsv(data: Record<string, unknown>): string {
  const b2b = ((data.b2b ?? []) as Array<Record<string, unknown>>);
  const b2c = ((data.b2c ?? []) as Array<Record<string, unknown>>);
  const lines: string[] = [];
  lines.push('Section,GSTIN,Customer,Invoice,Date,TaxableValue,IGST,CGST,SGST,CESS,Total');
  for (const r of b2b) {
    lines.push([
      'B2B',
      r.gstin, r.customerName, r.invoiceNumber,
      r.date ? new Date(r.date as string).toISOString().slice(0, 10) : '',
      r.taxableValue, r.igst, r.cgst, r.sgst, r.cess, r.total,
    ].map(escapeCsv).join(','));
  }
  lines.push('');
  lines.push('Section,PlaceOfSupply,InvoiceCount,TaxableValue,Tax');
  for (const r of b2c) {
    lines.push([
      'B2C',
      r.placeOfSupply, r.invoiceCount, r.taxableValue, r.tax,
    ].map(escapeCsv).join(','));
  }
  return lines.join('\n');
}

function gstr3bToCsv(data: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push('Section,Field,Value');
  const sections = ['3.1_outwardSupplies', '3.2_interStateUnregistered', '4_itcEligible', '6.1_taxPayable'];
  for (const s of sections) {
    const section = data[s] as Record<string, unknown> | undefined;
    if (!section) continue;
    for (const [k, v] of Object.entries(section)) {
      lines.push([s, k, v].map(escapeCsv).join(','));
    }
  }
  return lines.join('\n');
}

export async function exportGstr1(req: Request, res: Response): Promise<void> {
  const { res: fakeRes, captured } = captureResponse();
  await gstr1Handler(req, fakeRes);
  if (captured.status !== 200) {
    res.status(captured.status).json(captured.body);
    return;
  }
  const body = captured.body as { success: boolean; data: Record<string, unknown> };
  const format = (req.query.format as string | undefined) ?? 'json';
  const from = (req.query.from as string | undefined) ?? '';
  const to = (req.query.to as string | undefined) ?? '';
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gstr1_${from}_${to}.csv"`);
    res.send(gstr1ToCsv(body.data));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gstr1_${from}_${to}.json"`);
    res.send(JSON.stringify(body.data, null, 2));
  }
}

export async function exportGstr3b(req: Request, res: Response): Promise<void> {
  const { res: fakeRes, captured } = captureResponse();
  await gstr3bHandler(req, fakeRes);
  if (captured.status !== 200) {
    res.status(captured.status).json(captured.body);
    return;
  }
  const body = captured.body as { success: boolean; data: Record<string, unknown> };
  const format = (req.query.format as string | undefined) ?? 'json';
  const from = (req.query.from as string | undefined) ?? '';
  const to = (req.query.to as string | undefined) ?? '';
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gstr3b_${from}_${to}.csv"`);
    res.send(gstr3bToCsv(body.data));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gstr3b_${from}_${to}.json"`);
    res.send(JSON.stringify(body.data, null, 2));
  }
}

const handlers = { exportGstr1, exportGstr3b };
module.exports = handlers;
module.exports.default = handlers;
