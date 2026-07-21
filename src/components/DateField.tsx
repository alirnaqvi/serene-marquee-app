"use client";

export default function DateField({
  value,
  onChange,
  className = "",
}: {
  value: string; // ISO yyyy-mm-dd, or "" if unset
  onChange: (isoDate: string) => void;
  className?: string;
}) {
  return (
    <input
      type="date"
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
