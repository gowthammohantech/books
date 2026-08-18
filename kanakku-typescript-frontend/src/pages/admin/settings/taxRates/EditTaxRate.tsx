import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";

import TaxRateForm from "@pages/admin/settings/taxRates/CreateTaxRate";
import type { TaxRateFormData } from "@pages/admin/settings/taxRates/CreateTaxRate";
import Constants from "@constants/api";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import FullPageLoader from "@components/admin/FullPageLoader";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { hasPermission } from "@utils/hasPermission";
import type { TaxRate } from "@models/taxRate";
import { Button } from "@components/ui";

const EditTaxRate: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];

    const [taxRate, setTaxRate] = useState<TaxRateFormData | null>(null);
    const [isFetching, setIsFetching] = useState<boolean>(true);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);

    useEffect(() => {
        if (id) {
            void fetchTaxRateData(id);
        }
    }, [id]);

    const fetchTaxRateData = async (taxRateId: string) => {
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.GET_TAX_RATE_FOR_EDIT_URL}/${taxRateId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = response.data?.data?.taxRate as TaxRate | undefined;
            if (data) {
                const formatted: TaxRateFormData = {
                    id: data.id,
                    name: data.name || '',
                    rate: data.rate !== null && data.rate !== undefined ? String(data.rate) : '',
                    regime: data.regime,
                    taxKind: data.taxKind ?? '',
                    countryId: data.countryId || '',
                    stateId: data.stateId || '',
                    isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
                };
                setTaxRate(formatted);
            }
        } catch (error) {
            console.error('Error fetching tax rate data:', error);
            toast.error('Failed to load tax rate.');
        } finally {
            setIsFetching(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!id) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_TAX_RATE_URL}/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            toast.success('Tax rate deleted successfully');
            setDeleteModalOpen(false);
            navigate('/admin/settings/tax-rates');
        } catch (error) {
            console.error('Error deleting tax rate:', error);
            toast.error('Failed to delete tax rate.');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            {hasPermission(permissions, 'finance-settings', 'delete') && taxRate && (
                <div className="flex justify-end mb-3">
                    <Button
                        type="button"
                        variant="danger"
                        onClick={() => setDeleteModalOpen(true)}
                        leftIcon={<Trash2Icon size={14} />}
                    >
                        Delete Tax
                    </Button>
                </div>
            )}

            <TaxRateForm taxRateData={taxRate || null} />

            {isFetching && <FullPageLoader />}

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Tax"
                message="Are you sure you want to delete this tax? This action cannot be undone."
            />
        </>
    );
};

export default EditTaxRate;
