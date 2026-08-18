import { useEffect, useState } from "react";
import CustomerForm from "@pages/admin/customers/CreateCustomer";
import { useParams } from "react-router-dom";
import axios from "axios";
import Constants from "@constants/api";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import FullPageLoader from "@components/admin/FullPageLoader";

interface CustomerFormData {
    id?: string;
    name: string;
    email: string;
    phone: string;
    website: string;
    image: File | null;
    imagePreview: string | null;
    profile_image_removed: boolean;
    notes: string;
    status: boolean;
    currencyCode: string;
    billingName: string;
    billingAddressLine1: string;
    billingAddressLine2: string;
    billingCity: string;
    billingState: string;
    billingCountry: string;
    billingPincode: string;
    shippingName: string;
    shippingAddressLine1: string;
    shippingAddressLine2: string;
    shippingCity: string;
    shippingState: string;
    shippingCountry: string;
    shippingPincode: string;
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    IFSC: string;
    branch: string;
    _billingAddress?: any;
    _shippingAddress?: any;
    _bankDetails?: any;
}
const EditCustomer: React.FC = () => {

    const { id } = useParams<{ id: string }>();
    const { token } = useSelector((state: RootState) => state.auth);
    const [customer, setCustomer] = useState<CustomerFormData | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    useEffect(() => {
        fetchCustomerData(id);
    }, [id]);

    const fetchCustomerData = async (id: string | undefined) => {
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.GET_CUSTOMER_FOR_EDIT_URL}/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if(response.data.data) {
                let data = response.data.data;
                const formattedData = {
                    id : data.id,
                    name : data.name,
                    email : data.email,
                    phone : data.phone,
                    website : data.website,
                    image : null,
                    imagePreview : data.imageUrl,
                    profile_image_removed : false,
                    notes : data.notes,
                    status : data.status,
                    currencyCode : data.currencyCode || '',
                    billingName : data.billingAddress.name,
                    billingAddressLine1 : data.billingAddress.addressLine1,
                    billingAddressLine2 : data.billingAddress.addressLine2,
                    billingCity : data.billingAddress.city,
                    billingState : data.billingAddress.state,
                    billingCountry : data.billingAddress.country,
                    billingPincode : data.billingAddress.pincode,
                    shippingName : data.shippingAddress.name,
                    shippingAddressLine1 : data.shippingAddress.addressLine1,
                    shippingAddressLine2 : data.shippingAddress.addressLine2,
                    shippingCity : data.shippingAddress.city,
                    shippingState : data.shippingAddress.state,
                    shippingCountry : data.shippingAddress.country,
                    shippingPincode : data.shippingAddress.pincode,
                    bankName : data.bankDetails.bankName,
                    accountHolderName : data.bankDetails.accountHolderName,
                    accountNumber : data.bankDetails.accountNumber,
                    IFSC : data.bankDetails.IFSC,
                    branch : data.bankDetails.branch
                }
                
                setCustomer(formattedData);
            }
        } catch (error) {
            console.error('Error fetching customer data:', error);
        } finally {
            setIsFetching(false);
        }
    };


    return (
      <>
        <CustomerForm customerData={customer || null}/>
        {isFetching && <FullPageLoader />}
      </>
    );
};

export default EditCustomer;