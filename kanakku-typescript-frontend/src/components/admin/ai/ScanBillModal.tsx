/**
 * Three-step "Scan Bill" modal (Cluster H, slice H.2):
 *   1. Upload   — drag-drop / file-picker for PDF/JPG/PNG/WEBP
 *   2. Extract  — busy spinner while POST /ai/extract-bill runs
 *   3. Review   — editable form pre-filled from extracted JSON; supplier
 *                 match indicator; "Save as Purchase" → POST /confirm.
 *
 * Confidence-tinted fields: anything with `_confidence < 0.7` (only
 * surfaced as a whole-payload value today) shows a yellow banner. The
 * line-item table is fully editable; the totals recompute on edit.
 */
import { useMemo, useState, type ChangeEvent, type DragEvent, type FC } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import Constants from '@constants/api';
import Modal from '@components/admin/Modal';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';
import type { RootState } from '@store/index';

type Step = 'upload' | 'extracting' | 'review';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}
interface TaxRow {
  label: string;
  rate: number;
  amount: number;
}
interface ExtractedData {
  vendorName: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  lineItems: LineItem[];
  taxBreakdown: TaxRow[];
  subtotal: number;
  total: number;
  notes: string | null;
  _confidence: number;
}
interface SupplierMatch {
  supplierId?: string;
  supplierName?: string;
  matchType: 'gstin' | 'fuzzy' | 'none';
  score?: number;
}

interface ScanBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmed?: (purchaseId: string) => void;
}

const ACCEPT = 'application/pdf,image/jpeg,image/jpg,image/png,image/webp';

const ScanBillModal: FC<ScanBillModalProps> = ({ isOpen, onClose, onConfirmed }) => {
  const token = useSelector((s: RootState) => s.auth.token);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [data, setData] = useState<ExtractedData | null>(null);
  const [match, setMatch] = useState<SupplierMatch | null>(null);
  const [createSupplier, setCreateSupplier] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setStep('upload');
    setFile(null);
    setDragging(false);
    setError(null);
    setJobId(null);
    setData(null);
    setMatch(null);
    setCreateSupplier(false);
    setSupplierName('');
    setSupplierEmail('');
    setSupplierPhone('');
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      setError('File too large (max 10MB).');
      return;
    }
    const okType =
      f.type === 'application/pdf' ||
      f.type === 'image/jpeg' ||
      f.type === 'image/jpg' ||
      f.type === 'image/png' ||
      f.type === 'image/webp';
    if (!okType) {
      setError('Unsupported file type. Use PDF, JPG, PNG, or WEBP.');
      return;
    }
    setFile(f);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    handleFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0] ?? null);
  }

  async function startExtraction() {
    if (!file || !token) return;
    setStep('extracting');
    setError(null);
    try {
      const form = new FormData();
      form.append('bill', file);
      const res = await axios.post(Constants.AI_EXTRACT_BILL_URL, form, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
      const payload = res.data?.data;
      if (!payload?.extractedData) {
        throw new Error(res.data?.message ?? 'Extraction returned no data');
      }
      setJobId(payload.jobId);
      setData(payload.extractedData as ExtractedData);
      setMatch(payload.supplierMatch as SupplierMatch);
      if (payload.extractedData.vendorName) {
        setSupplierName(payload.extractedData.vendorName);
      }
      setStep('review');
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? err.message)
        : err instanceof Error
          ? err.message
          : 'Extraction failed';
      setError(message);
      setStep('upload');
    }
  }

  async function handleConfirm() {
    if (!jobId || !data || !token) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        extractedData: data,
      };
      if (match?.supplierId && !createSupplier) {
        body.supplierId = match.supplierId;
      } else if (createSupplier && supplierName.trim()) {
        body.createSupplier = {
          name: supplierName.trim(),
          email: supplierEmail.trim() || undefined,
          phone: supplierPhone.trim() || undefined,
        };
      }
      const res = await axios.post(
        `${Constants.AI_EXTRACT_BILL_URL}/${jobId}/confirm`,
        body,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const purchaseId = res.data?.data?.purchaseId;
      toast.success('Purchase created from bill.');
      if (purchaseId && onConfirmed) onConfirmed(purchaseId);
      handleClose();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? err.message)
        : err instanceof Error
          ? err.message
          : 'Failed to create purchase';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateLine(i: number, patch: Partial<LineItem>) {
    if (!data) return;
    const next = [...data.lineItems];
    const merged = { ...next[i], ...patch } as LineItem;
    if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
      merged.amount = Number((merged.quantity * merged.unitPrice).toFixed(2));
    }
    next[i] = merged;
    setData({ ...data, lineItems: next });
  }

  function addLine() {
    if (!data) return;
    setData({
      ...data,
      lineItems: [
        ...data.lineItems,
        { description: '', quantity: 1, unitPrice: 0, amount: 0 },
      ],
    });
  }
  function removeLine(i: number) {
    if (!data) return;
    setData({ ...data, lineItems: data.lineItems.filter((_, idx) => idx !== i) });
  }

  function updateTax(i: number, patch: Partial<TaxRow>) {
    if (!data) return;
    const next = [...data.taxBreakdown];
    next[i] = { ...next[i], ...patch } as TaxRow;
    setData({ ...data, taxBreakdown: next });
  }
  function addTax() {
    if (!data) return;
    setData({
      ...data,
      taxBreakdown: [...data.taxBreakdown, { label: 'Tax', rate: 0, amount: 0 }],
    });
  }
  function removeTax(i: number) {
    if (!data) return;
    setData({ ...data, taxBreakdown: data.taxBreakdown.filter((_, idx) => idx !== i) });
  }

  const totals = useMemo(() => {
    if (!data) return { subtotal: 0, taxTotal: 0, total: 0 };
    const subtotal = data.lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);
    const taxTotal = data.taxBreakdown.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return { subtotal, taxTotal, total: subtotal + taxTotal };
  }, [data]);

  if (!isOpen) return null;

  const lowConfidence = data && data._confidence < 0.7;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Scan Bill (AI)" size="3xl">
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-12 px-6 transition-colors ${
              dragging
                ? 'border-purple-500 bg-purple-50'
                : 'border-gray-300 bg-gray-50'
            }`}
          >
            <Upload size={36} className="text-purple-500" />
            <p className="text-gray-700 font-medium">
              {file ? file.name : 'Drop a bill here or click to upload'}
            </p>
            <p className="text-xs text-gray-500">PDF, JPG, PNG, or WEBP — up to 10MB</p>
            <label className="mt-3 cursor-pointer bg-purple-600 hover:bg-purple-700 text-white px-4 py-1.5 rounded-md text-sm">
              Choose file
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-sm">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 text-sm text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={startExtraction}
              disabled={!file}
              className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm flex items-center gap-1.5"
            >
              <FileText size={14} /> Extract bill
            </button>
          </div>
        </div>
      )}

      {step === 'extracting' && (
        <div className="flex flex-col items-center gap-3 py-12">
          <Loader2 size={36} className="animate-spin text-purple-600" />
          <p className="text-gray-700 font-medium">Reading your bill…</p>
          <p className="text-xs text-gray-500">Usually takes 2–10 seconds.</p>
        </div>
      )}

      {step === 'review' && data && (
        <div className="space-y-4">
          {lowConfidence && (
            <div className="flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2 text-sm">
              <AlertTriangle size={16} />
              <span>Low confidence ({(data._confidence * 100).toFixed(0)}%). Please double-check every field.</span>
            </div>
          )}

          {/* Supplier match */}
          <div className="bg-gray-50 border border-gray-200 rounded-md px-4 py-3">
            {match?.supplierId && !createSupplier ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-green-600" />
                <div className="flex-1">
                  <p className="text-sm text-gray-800">
                    Matched supplier: <strong>{match.supplierName}</strong>
                    {match.score !== undefined ? ` (${(match.score * 100).toFixed(0)}%)` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateSupplier(true)}
                  className="text-xs text-purple-600 hover:text-purple-800"
                >
                  Use a new supplier instead
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <UserPlus size={18} className="text-purple-600" />
                  <p className="text-sm text-gray-800">
                    {match?.supplierId
                      ? 'Create a new supplier'
                      : 'No matching supplier — create a new one'}
                  </p>
                  {match?.supplierId && (
                    <button
                      type="button"
                      onClick={() => setCreateSupplier(false)}
                      className="ml-auto text-xs text-purple-600 hover:text-purple-800"
                    >
                      Use matched ({match.supplierName})
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Supplier name"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Phone (optional)"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Vendor / invoice header */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor name" value={data.vendorName ?? ''} onChange={(v) => setData({ ...data, vendorName: v })} />
            <Field label="Vendor GSTIN" value={data.vendorGstin ?? ''} onChange={(v) => setData({ ...data, vendorGstin: v })} />
            <Field label="Invoice #" value={data.invoiceNumber ?? ''} onChange={(v) => setData({ ...data, invoiceNumber: v })} />
            <Field label="Currency" value={data.currency} onChange={(v) => setData({ ...data, currency: v })} />
            <Field label="Invoice date" type="date" value={data.invoiceDate ?? ''} onChange={(v) => setData({ ...data, invoiceDate: v })} />
            <Field label="Due date" type="date" value={data.dueDate ?? ''} onChange={(v) => setData({ ...data, dueDate: v })} />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700">Line items</h3>
              <button type="button" onClick={addLine} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                <Plus size={12} /> Add row
              </button>
            </div>
            <table className="w-full text-sm border border-gray-200">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-2 py-1 font-medium">Description</th>
                  <th className="text-right px-2 py-1 font-medium w-20">Qty</th>
                  <th className="text-right px-2 py-1 font-medium w-28">Unit price</th>
                  <th className="text-right px-2 py-1 font-medium w-28">Amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {data.lineItems.map((li, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={li.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                        className="w-full border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={li.quantity}
                        onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                        className="w-full text-right border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={li.unitPrice}
                        onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                        className="w-full text-right border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        value={li.amount}
                        onChange={(e) => updateLine(i, { amount: Number(e.target.value) })}
                        className="w-full text-right border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button type="button" onClick={() => removeLine(i)} className="text-gray-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tax breakdown */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700">Tax breakdown</h3>
              <button type="button" onClick={addTax} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                <Plus size={12} /> Add tax
              </button>
            </div>
            <table className="w-full text-sm border border-gray-200">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-2 py-1 font-medium">Label</th>
                  <th className="text-right px-2 py-1 font-medium w-20">Rate %</th>
                  <th className="text-right px-2 py-1 font-medium w-28">Amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {data.taxBreakdown.map((t, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={t.label}
                        onChange={(e) => updateTax(i, { label: e.target.value })}
                        className="w-full border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={t.rate}
                        onChange={(e) => updateTax(i, { rate: Number(e.target.value) })}
                        className="w-full text-right border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        value={t.amount}
                        onChange={(e) => updateTax(i, { amount: Number(e.target.value) })}
                        className="w-full text-right border border-transparent hover:border-gray-300 focus:border-purple-500 focus:outline-none rounded px-1"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button type="button" onClick={() => removeTax(i)} className="text-gray-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-72 text-sm space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{totals.subtotal.toFixed(2)} {data.currency}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tax</span>
                <span>{totals.taxTotal.toFixed(2)} {data.currency}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-900">
                <span>Total</span>
                <span>{totals.total.toFixed(2)} {data.currency}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-sm">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 flex items-center gap-1.5"
            >
              <X size={14} /> Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || (!match?.supplierId && (!createSupplier || !supplierName.trim()))}
              className="px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save as Purchase
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date';
}
const Field: FC<FieldProps> = ({ label, value, onChange, type = 'text' }) => {
  if (type === 'date') {
    // Settings-aware picker. State stays a "yyyy-MM-dd" string (or '' when
    // cleared) so the confirm payload is byte-identical to the native input.
    return (
      <div className="text-sm">
        <DateInput
          label={label}
          value={ymdStringToDate(value)}
          onChange={(date) => onChange(dateToYmdString(date))}
        />
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
      />
    </label>
  );
};

export default ScanBillModal;
