import './CustomCheckbox.css';
interface CustomCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string
}

const CustomCheckbox: React.FC<CustomCheckboxProps> = ({ checked, onChange, disabled = false, name }) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled) {
      onChange(event.target.checked);
    }
  };

  return (
    <label className="custom-checkbox-container">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        name={name || ''}
        id={name || ''}
      />
      <span className="checkmark"></span>
    </label>
  );
};

export default CustomCheckbox;