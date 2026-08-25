import { useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import Modal from '@components/admin/Modal';
import SubmitButton from '@components/admin/SubmitButton';
import { Button, FormField, fieldControlClasses } from '@components/ui';

interface GrantCreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  /** Called after a successful grant so the host can re-fetch the summary. */
  onSuccess: () => void;
}

const GrantCreditModal: React.FC<GrantCreditModalProps> = ({ isOpen, onClose, contactId, onSuccess }) => {
  const { token } = useSelector((state: RootState) => state.auth);
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleClose = () => {
    if (isSaving) return;
    setAmount('');
    setReason('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    const parsed = Number(amount);
    if (!amount || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Please enter a positive amount.');
      return;
    }
    setError(null);
    try {
      setIsSaving(true);
      await axios.post(
        `${Constants.API_BASE_URL}/admin/contacts/${contactId}/credits`,
        { amount: parsed, reason: reason.trim() || undefined },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success('Credit granted successfully.');
      setAmount('');
      setReason('');
      onSuccess();
    } catch (err) {
      const axiosError = err as { response?: { data?: { message?: string; error?: string } } };
      const data = axiosError.response?.data;
      toast.error(data?.message || data?.error || 'Failed to grant credit.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Grant Account Credit" size="sm">
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <FormField
          label="Amount"
          required
          id="grantCreditAmount"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error ?? undefined}
        />

        <div className="mt-4">
          <FormField label="Reason (optional)" id="grantCreditReason">
            {(field) => (
              <textarea
                id={field.id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Goodwill, Timely payment bonus, Promotional credit"
                className={fieldControlClasses()}
                rows={3}
              />
            )}
          </FormField>
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="white" onClick={handleClose} className="mr-2">
            Cancel
          </Button>
          <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create">
            Grant Credit
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
};

export default GrantCreditModal;
