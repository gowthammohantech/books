import { useState } from "react";
import ExpenseCategoryList from "@pages/admin/finance-and-accounting/ExpenseCategoryList";
import CustomFieldList from "../customFields/CustomFieldList";
import { PageHeader } from "@/context/PageHeaderContext";
import { Tabs, type TabItem } from "@components/ui";

const tabs: TabItem[] = [
    { key: 'expense-categories', label: 'Expense Categories' },
    { key: 'custom-fields', label: 'Custom Fields' }
];

const ExpenseSettings: React.FC = () => {

    const [activeTab, setActiveTab] = useState<string>(tabs[0].key);

    return (
        <div className="space-y-4">
            <PageHeader title="Expense Settings" />
            <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />
            {/* Tab Content */}
            <div className="mt-4">
                {activeTab === 'expense-categories' && <ExpenseCategoryList />}
                {activeTab === 'custom-fields' && <CustomFieldList moduleSlug="expenses" />}
            </div>
        </div>
    );
}
export default ExpenseSettings;