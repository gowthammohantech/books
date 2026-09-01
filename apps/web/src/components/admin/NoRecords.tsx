type NoRecordsProps = {
    colSpan: number;
    message?: string;
};

const NoRecords: React.FC<NoRecordsProps> = ({ colSpan, message = "No records found" }) => {
    return (
        <tr className="border-b border-gray-200 hover:bg-gray-50">
            <td
                colSpan={colSpan}
                className="px-4 py-[14px] text-center text-sm text-gray-600 font-medium"
            >
                {message}
            </td>
        </tr>
    );
};

export default NoRecords;
