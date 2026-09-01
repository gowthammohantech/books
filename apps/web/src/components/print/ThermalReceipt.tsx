import React, { forwardRef } from 'react';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import { adaptDocument, type ThermalDocType } from './thermalAdapter';
import { thermalWidthMm } from './thermalPageStyle';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { companyTaxId } from '@utils/companyTaxId';

interface ThermalReceiptProps {
    docType: ThermalDocType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemSettings: any;
    width: 80 | 58;
}

const DASHED = '--------------------------------';

const ThermalReceipt = forwardRef<HTMLDivElement, ThermalReceiptProps>(
    ({ docType, data, systemSettings, width }, ref) => {
        const { formatMoney } = useCurrencies();
        const { formatDate } = useDateFormatter();

        const doc = adaptDocument(docType, data);
        const fmt = (amount: number) => formatMoney(amount, doc.currencyCode || null);

        const dateFormat: string =
            systemSettings?.dateFormat?.format ?? 'DD-MM-YYYY';

        // Company's own regime-appropriate tax ID (GSTIN/VAT/ABN/GST No.) — the
        // normal print templates (InvoiceTemplateA/B) already show this; the
        // thermal receipt was missing it in the company header block.
        const companyTax = companyTaxId(systemSettings?.company);

        const containerStyle: React.CSSProperties = {
            width: thermalWidthMm(width),
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '3mm',
            boxSizing: 'border-box',
        };

        const rowStyle: React.CSSProperties = {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
        };

        return (
            <div ref={ref} style={containerStyle}>
                {/* Company header */}
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                    <img
                        src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                        alt="Logo"
                        style={{ maxWidth: '60%', height: 'auto', display: 'block', margin: '0 auto 4px' }}
                    />
                    <div style={{ fontWeight: 'bold', fontSize: 13 }}>
                        {systemSettings?.company?.companyName ?? ''}
                    </div>
                    {systemSettings?.company?.address && (
                        <div style={{ fontSize: 10 }}>{systemSettings.company.address}</div>
                    )}
                    {systemSettings?.company?.phone && (
                        <div style={{ fontSize: 10 }}>{systemSettings.company.phone}</div>
                    )}
                    {companyTax && (
                        <div style={{ fontSize: 10 }}>{companyTax.label}: {companyTax.value}</div>
                    )}
                </div>

                {/* Document title */}
                <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 2 }}>
                    {doc.title}
                </div>

                {/* Document number + date */}
                <div style={rowStyle}>
                    <span>#{doc.number}</span>
                    <span>{formatDate(doc.dateLabel, dateFormat)}</span>
                </div>

                {/* Party */}
                {doc.party.name && (
                    <div style={{ marginTop: 4 }}>
                        <div style={{ fontWeight: 'bold' }}>{doc.party.name}</div>
                        {doc.party.address && (
                            <div style={{ fontSize: 10 }}>{doc.party.address}</div>
                        )}
                        {doc.party.gstin && (
                            <div style={{ fontSize: 10 }}>GSTIN: {doc.party.gstin}</div>
                        )}
                    </div>
                )}

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Items */}
                {doc.items.map((item, idx) => (
                    <div key={idx} style={{ marginBottom: 3 }}>
                        <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                        <div style={rowStyle}>
                            <span>
                                {item.qty} x {fmt(item.rate)}
                            </span>
                            <span>{fmt(item.amount)}</span>
                        </div>
                    </div>
                ))}

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Subtotal */}
                <div style={rowStyle}>
                    <span>Subtotal</span>
                    <span>{fmt(doc.subtotal)}</span>
                </div>

                {/* Tax lines */}
                {doc.taxLines.map((tl, idx) => (
                    <div key={idx} style={rowStyle}>
                        <span>{tl.label}</span>
                        <span>{fmt(tl.amount)}</span>
                    </div>
                ))}

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Grand total */}
                <div style={{ ...rowStyle, fontWeight: 'bold', fontSize: 13 }}>
                    <span>TOTAL</span>
                    <span>{fmt(doc.total)}</span>
                </div>

                {/* Notes */}
                {doc.notes && (
                    <div style={{ marginTop: 6, fontSize: 10, borderTop: '1px dashed #000', paddingTop: 4 }}>
                        <div style={{ fontWeight: 'bold' }}>Notes:</div>
                        <div>{doc.notes}</div>
                    </div>
                )}

                {/* Footer spacer */}
                <div style={{ textAlign: 'center', fontSize: 10, marginTop: 6 }}>
                    {DASHED}
                </div>
            </div>
        );
    },
);

ThermalReceipt.displayName = 'ThermalReceipt';

export default ThermalReceipt;
