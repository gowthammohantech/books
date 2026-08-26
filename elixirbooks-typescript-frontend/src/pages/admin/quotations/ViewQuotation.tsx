import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { useNavigate, useParams } from "react-router-dom";
import Constants from "@constants/api";
import axios from "axios";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import type { QuotationDetail } from "@models/quotation";
import QuotationTemplate from "./QuotationTemplate";
import PrintMenu from "@components/print/PrintMenu";
import { PageHeader } from "@/context/PageHeaderContext";
import { useLineItemCustomFields } from "@hooks/useLineItemCustomFields";

const ViewQuotation: React.FC = () => {
    const { id: quotationId } = useParams<{ id: string }>()
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [isFetching, setIsFetching] = useState(true);
    const [quotationDetails, setQuotationDetails] = useState<QuotationDetail | null>(null);
    const { fields: lineFields } = useLineItemCustomFields(token, "quotations");

    useEffect(() => {
        const fetchQuotationDetails = async () => {
            try {
                setIsFetching(true);
                const response = await axios.get(`${Constants.FETCH_QUOTATION_DETAILS_URL}/${quotationId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                if (response.data.data) {
                    setQuotationDetails(response.data.data);
                }
            } catch (error) {
                console.error('Error fetching quotation details:', error);
            } finally {
                setIsFetching(false);
            }
        }
        if (quotationId) {
            fetchQuotationDetails();
        }
    }, [quotationId, token]);

    const navigate = useNavigate();
    const componentRef = useRef<HTMLDivElement>(null);
    const quotationTitle = quotationDetails?.quotationId
        ? `Quotation-${quotationDetails.quotationId}`
        : "Quotation";
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: quotationTitle,
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

    if (isFetching) {
        return (
            <div className="p-6 space-y-4 flex items-center justify-center h-screen">
                <LoaderSpinner />
            </div>
        );
    }

    const SelectedTemplate = QuotationTemplate;
    return (
        <>
            <PageHeader
                title={
                    quotationDetails?.quotationId
                        ? `Quotation ${quotationDetails.quotationId}`
                        : "Quotation"
                }
            >
                <PrintMenu
                    normalPrint={handlePrint}
                    docType="QUOTATION"
                    data={quotationDetails}
                    systemSettings={systemSettings}
                    documentTitle={quotationTitle}
                    normalLabel="Normal (A4)"
                />
                {/* Back Button */}
                {token &&
                    <button
                        onClick={() => navigate("/admin/quotations")}
                        className="bg-gray-300 hover:bg-gray-400 text-gray-950 px-4 py-2 rounded cursor-pointer"
                    >
                        Back
                    </button>
                }
            </PageHeader>

            {/* Printable content */}
            <div ref={componentRef}>
                {quotationDetails ? (
                    <SelectedTemplate quotationDeta={quotationDetails} lineFields={lineFields} />
                ) : (
                    <p>Loading invoice…</p>
                )}
            </div>
        </>
    );
};

export default ViewQuotation;