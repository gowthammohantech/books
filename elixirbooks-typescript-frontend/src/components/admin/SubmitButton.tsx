import { Loader2, Save } from "lucide-react";

type SubmitButtonProps = {
    isLoading?: boolean;
    isDisabled?: boolean;
    mode?: "create" | "edit"; // modes for context
    onClick?: () => void;
    children?: React.ReactNode; // optional override label
    form?: string; // HTML form-association: lets the button live outside its <form>
};

const SubmitButton: React.FC<SubmitButtonProps> = ({
    isLoading = false,
    isDisabled = false,
    mode = "create",
    onClick,
    children,
    form,
}) => {
    // Dynamic label & icon based on mode
    const getLabel = () => {
        if (isLoading) return "Saving...";
        if (mode === "edit") return "Save Changes";
        return "Create";
    };

    const getIcon = () => {
        if (isLoading) return <Loader2 size={16} className="animate-spin" />;
        if (mode === "edit") return <Save size={16} />;
        return <Save size={16} />;
    };

    return (
        <button
            type="submit"
            form={form}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary border border-transparent rounded-md hover:bg-primary/90 focus:outline-none flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            onClick={onClick}
            disabled={isLoading || isDisabled}
        >
            {getIcon()}
            {children || getLabel()}
        </button>
    );
};

export default SubmitButton;
