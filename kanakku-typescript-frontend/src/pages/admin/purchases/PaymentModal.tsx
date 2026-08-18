import type React from "react";
import { useState, useEffect } from "react";
import Modal from "@components/admin/Modal";
import { UploadCloud } from "lucide-react";
import SearchableDropdown from "@components/admin/SearchableDropdown";
import DateInput from "@components/admin/DateInput";
import { round2 } from "@utils/round2";
import { Button, FormField, fieldControlClasses } from "@components/ui";

// Props for the modal component
interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: any) => void;
    totalAmount: number;
    paymentModes: IPaymentMode[]
}

interface IPaymentMode {
    id: string;
    name: string;
    slug: string;
}

// Data structure for the payment form
interface PaymentModalData {
    purchaseOrderId?: string;
    userId: string;
    billFrom: string;
    billTo: string;
    referenceNo: string;
    purchaseDate: Date | null;
    status: string;
    items: productItem[];
    notes: string;
    termsAndCondition: string;
    paymentMode: string;
    paymentModeSlug: string;
    checkNumber?: string;
    bank?: string | null;
    sign_type: 'none' | 'digitalSignature' | 'eSignature';
    signatureId: string | null;
    signatureName: string;
    esignDataUrl: string | null;
    subTotal: number | null;
    totalTax: number | null;
    totalDiscount: number | null;
    grandTotal: number | null;
    sp_referenceNumber?: string;
    sp_paymentDate?: Date | null;
    sp_paymentMode?: string;
    sp_amount?: number;
    sp_paid_amount?: number;
    sp_due_amount?: number;
    sp_notes?: string | null;
    sp_attachment?: File | null;
}

interface productItem {
    id: string;
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    tax_group_id?: string;
    discount_type?: 'Fixed' | 'Percentage';
    discount_value?: number;
}

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, onConfirm, totalAmount, paymentModes }) => {
    // Initial state for the form, updated to include all fields
    const [data, setData] = useState<PaymentModalData>({
        sp_referenceNumber: '',
        sp_paymentDate: new Date(),
        sp_paymentMode: '',
        sp_amount: totalAmount || 0,
        sp_paid_amount: 0,
        sp_due_amount: 0,
        sp_notes: '',
        sp_attachment: null,
    } as PaymentModalData);

    const [paymentFormErrors, setPaymentFormErrors] = useState<{ [key: string]: string }>({});
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        if (name === 'sp_paid_amount') {
            setData(prevData => ({
                ...prevData,
                sp_paid_amount: Number(value),
                // 2dp due so float drift never sends e.g. 31.729999 to the backend.
                sp_due_amount: round2((prevData.sp_amount ?? 0) - Number(value)),
            }));
        } else {
            setData(prevData => ({
                ...prevData,
                [name]: value,
            }));
        }

    };

    // A specific handler for the file input
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setData(prevData => ({
                ...prevData,
                sp_attachment: file,
            }));
        }
    };

    const validatePaymentForm = () => {
        const errors: { [key: string]: string } = {};

        if (!data.sp_paymentDate) {
            errors.sp_paymentDate = 'Payment Date is required.';
        }
        if (!data.sp_paymentMode) {
            errors.sp_paymentMode = 'Payment Mode is required.';
        }
        if (!data.sp_amount) {
            errors.sp_amount = 'Amount is required.';
        }
        if (!data.sp_paid_amount) {
            errors.sp_paid_amount = 'Paid Amount is required.';
        }
        // Validate against the amount DUE (for this create flow the full amount is
        // outstanding, so sp_amount IS the due), using the 2dp total. Allow
        // sub-unit payments (e.g. 0.50) — only reject non-positive amounts.
        const amountDue = round2(data.sp_amount ?? 0);
        if ((data.sp_paid_amount ?? 0) > amountDue) {
            errors.sp_paid_amount = 'Paid Amount cannot exceed the amount due.';
        } else if ((data.sp_paid_amount ?? 0) <= 0) {
            errors.sp_paid_amount = 'Paid Amount must be greater than 0.';
        }
        //allow max file size of 5MB
        if (data.sp_attachment && data.sp_attachment.size > 5 * 1024 * 1024) {
            errors.sp_attachment = 'File size must be less than 5MB.';
        }
        setPaymentFormErrors(errors);
        return Object.keys(errors).length === 0;
    }
    // Handler for form submission
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validatePaymentForm()) return;
        onConfirm(data);
    };

    // Reset form when the modal is closed
    useEffect(() => {
        if (!isOpen) {
            setData({
                sp_referenceNumber: '',
                sp_paymentDate: null,
                sp_paymentMode: '',
                sp_amount: totalAmount || 0,
                sp_paid_amount: 0,
                sp_due_amount: 0,
                sp_notes: '',
                sp_attachment: null
            } as PaymentModalData);
            setPaymentFormErrors({});
        }
    }, [isOpen, totalAmount]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Payment">
            <form onSubmit={handleSubmit} className="p-1">

                {/* --- Main Form Fields Grid --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Reference Number */}
                    <FormField
                        label="Reference Number"
                        id="sp_referenceNumber"
                        name="sp_referenceNumber"
                        type="text"
                        value={data.sp_referenceNumber}
                        onChange={handleChange}
                        error={paymentFormErrors.sp_referenceNumber}
                    />

                    {/* Payment Date */}
                    <div>
                        <DateInput
                            label="Order Date"
                            value={data.sp_paymentDate || null}
                            onChange={(newDate) => setData(prevData => ({ ...prevData, sp_paymentDate: newDate || null }))}
                            isRequired
                        />
                        {paymentFormErrors.sp_paymentDate && <p className="text-danger text-sm mt-1">{paymentFormErrors.sp_paymentDate}</p>}
                    </div>

                    {/* Payment Mode */}
                    <div>
                        <SearchableDropdown
                            label="Payment Mode"
                            options={paymentModes}
                            value={paymentModes.find(option => option.id === data.sp_paymentMode) || null}
                            onChange={(_, selectedOption) =>
                                setData(prevData => ({
                                    ...prevData,
                                    sp_paymentMode: selectedOption?.id || ''
                                }))
                            }
                            placeholder="Select Payment Mode"
                            required
                        />

                        {paymentFormErrors.sp_paymentMode && <p className="text-danger text-sm mt-1">{paymentFormErrors.sp_paymentMode}</p>}
                    </div>

                    {/* Amount */}
                    <FormField
                        label="Amount"
                        required
                        id="sp_amount"
                        name="sp_amount"
                        type="number"
                        value={data.sp_amount}
                        onChange={handleChange}
                        readOnly
                        error={paymentFormErrors.sp_amount}
                    />

                    {/* Paid Amount */}
                    <FormField
                        label="Paid Amount"
                        required
                        id="sp_paid_amount"
                        name="sp_paid_amount"
                        type="number"
                        value={data.sp_paid_amount}
                        onChange={handleChange}
                        error={paymentFormErrors.sp_paid_amount}
                    />

                    {/* Due Amount */}
                    <FormField
                        label="Due Amount"
                        required
                        id="sp_due_amount"
                        name="sp_due_amount"
                        type="number"
                        value={data.sp_due_amount}
                        readOnly
                        error={paymentFormErrors.sp_due_amount}
                    />

                    {/* Notes */}
                    <div className="md:col-span-3">
                        <FormField label="Notes" id="sp_notes">
                            {(field) => (
                                <textarea
                                    id={field.id}
                                    name="sp_notes"
                                    value={data.sp_notes || ''}
                                    onChange={handleChange}
                                    rows={2}
                                    className={fieldControlClasses()}
                                ></textarea>
                            )}
                        </FormField>
                    </div>

                    {/* Attachment */}
                    <div className="md:col-span-3">
                        <label className="block text-sm font-medium text-heading">Attachment</label>
                        <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-border border-dashed rounded-control">
                            <div className="space-y-1 text-center">
                                <UploadCloud className="mx-auto h-12 w-12 text-body" />
                                <div className="flex text-sm text-body">
                                    <label htmlFor="sp_attachment" className="relative cursor-pointer bg-white rounded-control font-medium text-purple-600 hover:text-purple-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-purple-600">
                                        <span className="font-bold">Browse your files</span>
                                        <input id="sp_attachment" name="sp_attachment" type="file" className="sr-only" onChange={handleFileChange} />
                                    </label>
                                </div>
                                <p className="text-xs text-body">Maximum size : 5 MB</p>
                            </div>
                        </div>
                        {data.sp_attachment && <p className="mt-2 text-sm text-body">Selected file: {data.sp_attachment.name}</p>}
                        {paymentFormErrors.sp_attachment && <p className="text-danger text-sm mt-1">{paymentFormErrors.sp_attachment}</p>}
                    </div>
                </div>

                {/* --- Form Actions --- */}
                <div className="flex justify-between items-center px-6 pb-6 pt-4">
                    <Button type="button" variant="white" onClick={() => { onClose(), setPaymentFormErrors({}) }}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary">
                        Create
                    </Button>
                </div>

            </form>
        </Modal>
    );
};

export default PaymentModal;