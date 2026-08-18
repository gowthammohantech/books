import { Loader2Icon } from "lucide-react";

interface LoaderProps {
  size?: number; // default size in px
  color?: string; // tailwind color classes
  className?: string; // extra styles
}

const LoaderSpinner: React.FC<LoaderProps> = ({
  size = 36,
  color = "text-purple-600",
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Loader2Icon
        className={`animate-spin ${color}`}
        style={{ width: size, height: size }}
      />
    </div>
  );
};

export default LoaderSpinner;
