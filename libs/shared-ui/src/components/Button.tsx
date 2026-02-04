interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}

/**
 * @param {React.ReactNode} children
 * @param {Function} onClick
 * @param {boolean} disabled
 * @param {string} variant
 * @returns {JSX.Element}
 */
export default function Button({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  className = "",
}: ButtonProps) {
  const baseStyles =
    "px-4 py-3 rounded-xl font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";
  const variantStyles =
    variant === "primary"
      ? "bg-accent text-background"
      : "bg-surface text-primary";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles} ${className}`}
    >
      {children}
    </button>
  );
}
