import { useEffect, useState } from "react";
import Modal from "@components/admin/Modal";
import axios, { AxiosError } from "axios";
import Constants from "@constants/api";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import SubmitButton from "@components/admin/SubmitButton";
import type { PaymentMode } from "@models/common";

interface CreatePaymentModeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newMode: PaymentMode) => void;
}

const CreatePaymentModeModal: React.FC<CreatePaymentModeModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { token } = useSelector((state: RootState) => state.auth);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setNameError('');
        }
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!name.trim()) {
            setNameError('Name is required.');
            return;
        }
        try {
            setIsSubmitting(true);
            const response = await axios.post(
                Constants.CREATE_PAYMENT_MODE_URL,
                { name: name.trim() },
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            toast.success('Payment mode created successfully.');
            onSuccess(response.data.data);
            onClose();
        } catch (error: any | AxiosError) {
            const message = error?.response?.data?.message;
            if (message) {
                setNameError(message);
            } else {
                toast.error('Something went wrong');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Payment Mode">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block font-medium text-sm text-gray-700">
                        Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        name="name"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            if (nameError) setNameError('');
                        }}
                        placeholder="Enter payment mode name"
                        className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                    {nameError && <p className="text-red-500 text-xs mt-1">{nameError}</p>}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 cursor-pointer"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <SubmitButton
                        isLoading={isSubmitting}
                        isDisabled={isSubmitting}
                        mode="create"
                    />
                </div>
            </form>
        </Modal>
    );
};

export default CreatePaymentModeModal;
