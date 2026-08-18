import { useState } from "react";
import Preferences from "@pages/admin/settings/moduleSettings/quotation/Preferences";
import CustomFieldList from "../customFields/CustomFieldList";
import { PageHeader } from "@/context/PageHeaderContext";
import { Tabs, type TabItem } from "@components/ui";

const tabs: TabItem[] = [
    { key: 'preferences', label: 'Preferences' },
    { key: 'custom-fields', label: 'Custom Fields' }
];

const QuotationSettings: React.FC = () => {

    const [activeTab, setActiveTab] = useState<string>(tabs[0].key);

    return (
        <div className="space-y-4">
            <PageHeader title="Quotation Settings" />
            <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />
            {/* Tab Content */}
            <div className="mt-4">
                {activeTab === 'preferences' && <Preferences />}
                {activeTab === 'custom-fields' && <CustomFieldList moduleSlug="quotations" />}
            </div>
        </div>
    );
}
export default QuotationSettings;