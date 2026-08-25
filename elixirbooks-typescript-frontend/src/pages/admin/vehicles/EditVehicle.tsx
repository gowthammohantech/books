import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";

import VehicleForm from "@pages/admin/vehicles/CreateVehicle";
import type { VehicleFormData } from "@pages/admin/vehicles/CreateVehicle";
import Constants from "@constants/api";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import FullPageLoader from "@components/admin/FullPageLoader";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { hasPermission } from "@utils/hasPermission";

const EditVehicle: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];

    const [vehicle, setVehicle] = useState<VehicleFormData | null>(null);
    const [isFetching, setIsFetching] = useState<boolean>(true);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);

    useEffect(() => {
        if (id) {
            void fetchVehicleData(id);
        }
    }, [id]);

    const fetchVehicleData = async (vehicleId: string) => {
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.GET_VEHICLE_FOR_EDIT_URL}/${vehicleId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = response.data?.data?.vehicle;
            if (data) {
                const formatted: VehicleFormData = {
                    id: data.id,
                    customerId: data.customerId || '',
                    customerName: data.customerName || '',
                    name: data.name || '',
                    make: data.make || '',
                    model: data.model || '',
                    year: data.year !== null && data.year !== undefined ? String(data.year) : '',
                    registrationNumber: data.registrationNumber || '',
                    vin: data.vin || '',
                    mileage: data.mileage !== null && data.mileage !== undefined ? String(data.mileage) : '',
                    notes: data.notes || '',
                    status: data.status !== undefined ? Boolean(data.status) : true,
                };
                setVehicle(formatted);
            }
        } catch (error) {
            console.error('Error fetching vehicle data:', error);
            toast.error('Failed to load vehicle.');
        } finally {
            setIsFetching(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!id) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_VEHICLE_URL}/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            toast.success('Vehicle deleted successfully');
            setDeleteModalOpen(false);
            navigate('/admin/vehicles');
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            toast.error('Failed to delete vehicle.');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            {hasPermission(permissions, 'vehicles', 'delete') && vehicle && (
                <div className="flex justify-end mb-3">
                    <button
                        type="button"
                        onClick={() => setDeleteModalOpen(true)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md shadow flex items-center gap-2 cursor-pointer"
                    >
                        <Trash2Icon size={14} /> Delete Vehicle
                    </button>
                </div>
            )}

            <VehicleForm vehicleData={vehicle || null} />

            {isFetching && <FullPageLoader />}

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Vehicle"
                message="Are you sure you want to delete this vehicle? This action cannot be undone."
            />
        </>
    );
};

export default EditVehicle;
