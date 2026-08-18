import { useState } from "react";
import CustomFieldList from "../customFields/CustomFieldList";
import { PageHeader } from "@/context/PageHeaderContext";
interface TabProps {
    label: string;
    slug: string;
}
const tabs = [
    { label: 'Custom Fields', slug: 'custom-fields' }
];

const ProductSettings: React.FC = () => {

    const [activeTab, setActiveTab] = useState<TabProps>(tabs[0]);

    return (
        <div className="space-y-4">
            <PageHeader title="Product Settings" />
            <div className="flex gap-4 py-2">
                {tabs.map((tab, index) => {
                    return (
                        <button
                            key={index + 1}
                            className={`font-medium text-sm ${activeTab?.slug === tab.slug ? 'border-b-2 text-purple-600' : ''} hover:text-purple-600`}
                            onClick={() => setActiveTab(tab)}
                        >{tab.label}
                        </button>
                    );
                })}
            </div>
            {/* Tab Content */}
            <div className="mt-4">
                {activeTab.slug === 'custom-fields' && <CustomFieldList moduleSlug="product-services" />}
            </div>
        </div>
    );
}
export default ProductSettings;
