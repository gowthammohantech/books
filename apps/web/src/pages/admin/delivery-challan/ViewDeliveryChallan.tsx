import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import axios from "axios";
import ChallanTemplateA from "./ChallanTemplateA";
import type { DeliveryChannalDetail } from "@models/delivery-challan";
import PrintMenu from "@components/print/PrintMenu";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";
import { ArrowLeft } from "lucide-react";
import { useLineItemCustomFields } from "@hooks/useLineItemCustomFields";

const ViewDeliveryChallan: React.FC = () => {
    const { id: challanId } = useParams<{ id: string }>()
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [challanDetails, setChallanDetails] = useState<DeliveryChannalDetail | null>(null);
    const { fields: lineFields } = useLineItemCustomFields(token, "invoices");

    useEffect(() => {
        const fetchChallanDetails = async () => {
            try {
                const response = await axios.get(`${Constants.FETCH_DELIVERY_CHALLAN_FOR_EDIT_URL}/${challanId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                if (response.data.data) {
                    setChallanDetails(response.data.data);
                }
            } catch (error) {
                console.error('Error fetching invoice details:', error);
            }
        }
        if (challanId && token) {
            fetchChallanDetails();
        }
    }, [challanId, token]);

    const navigate = useNavigate();
    const template = 1;
    const componentRef = useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: challanDetails?.challanNumber ? `Challan-${challanDetails.challanNumber}` : 'Challan',
        pageStyle: `
        @page {
        size: auto;
        margin: 5mm 5mm 2mm 2mm;
        }
        @page:first {
          margin: 2mm;
        }

        .page-break {
        page-break-before: always;
        }
    `,
    });
    return (
        <>
            {/* Actions in the top bar (Print + Back) — was previously at the bottom. */}
            <PageHeader title={challanDetails?.challanNumber ? `Delivery Challan ${challanDetails.challanNumber}` : "Delivery Challan"}>
                <div className="flex items-center gap-3">
                    <PrintMenu
                        normalPrint={handlePrint}
                        docType="CHALLAN"
                        data={challanDetails}
                        systemSettings={systemSettings}
                        documentTitle={challanDetails?.challanNumber ? `Challan-${challanDetails.challanNumber}` : 'Challan'}
                        normalLabel="Normal (A4)"
                    />
                    <Button variant="secondary" onClick={() => navigate("/admin/delivery-challans")}>
                        <ArrowLeft size={16} /> Back
                    </Button>
                </div>
            </PageHeader>

            {/* Printable content */}
            <div ref={componentRef}>
                {template === 1 && challanDetails ? <ChallanTemplateA challanData={challanDetails} lineFields={lineFields} /> : <div>Template 2</div>}
            </div>
        </>
    );
};

export default ViewDeliveryChallan;