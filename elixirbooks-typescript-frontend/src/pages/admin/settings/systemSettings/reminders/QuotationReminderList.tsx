import Switch from "@components/admin/Switch";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import axios from "axios";
import { Edit, Trash2Icon } from "lucide-react";
import { useSelector } from "react-redux";
import { Card } from "@components/ui";

interface Props {
    reminders: any;
    onSuccess: () => void;
    isEditing?: (id: string) => void;
    onDelete?: (id: string) => void;
}
const QuotationReminderList: React.FC<Props> = ({ reminders, onSuccess, isEditing, onDelete }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: (item: any) => handleEditClick(item)
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: (item: any) => handleDeleteClick(item)
        }
    ];

    const handleEditClick = (item: any) => {
        if (isEditing) {
            isEditing(item.id);
        }
    }
    const handleDeleteClick = (item: any) => {
        if (onDelete) {
            onDelete(item.id);
        }
    }
    const handleStatusChange = async (id: String, newStatus: boolean) => {
        try {
            await axios.patch(`${Constants.API_BASE_URL}/reminders/${id}/toggle`, { isEnabled: newStatus }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            onSuccess();
        } catch (error) {

        }
    }
    return (
        <div className="p-6">
            <Card
                padded={false}
                header={
                    <div className="px-5 py-4 border-b border-border text-lg font-semibold text-heading">
                        Quotation Reminders
                    </div>
                }
            >
                <Table headers={['#', 'Name', 'Schedule', 'Status', 'Action']}>
                    {reminders && reminders.length > 0 && reminders.map((reminder: any, index: number) => {
                        const formattedSchedule = reminder.remindDays + ' day(s) ' + reminder.remindTiming;
                        return (
                            <TableRow
                                key={reminder.id}
                                index={index + 1}
                                row={reminder}
                                columns={[
                                    <span className="text-indigo-600">{reminder.name ?? ""}</span>,
                                    formattedSchedule,
                                    <Switch name={`status-${reminder.id}`} checked={reminder.isEnabled} onChange={(e) => handleStatusChange(reminder.id, e.target.checked)} />,
                                ]}
                                actions={tableActions}
                            ></TableRow>
                        );
                    })}
                </Table>
            </Card>
        </div>
    );
}
export default QuotationReminderList;