import { Loader2 } from "lucide-react";

const FullPageLoader = () => {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
            <Loader2 className="h-12 w-12 animate-spin text-white" />
        </div>
    );
};

export default FullPageLoader;
