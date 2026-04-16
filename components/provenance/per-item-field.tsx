/**
 * Label + value presentational row for per-item provenance.
 *
 * Shows "Not recorded" in muted text when the value is null/undefined.
 */

interface PerItemFieldProps {
  label: string;
  value: React.ReactNode;
  /** Additional CSS classes for the value element */
  valueClassName?: string;
}

export default function PerItemField({
  label,
  value,
  valueClassName,
}: PerItemFieldProps) {
  const isEmpty = value === null || value === undefined || value === '';

  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          isEmpty
            ? 'text-sm italic text-muted-foreground/60'
            : `text-sm text-foreground ${valueClassName ?? ''}`
        }
      >
        {isEmpty ? 'Not recorded' : value}
      </dd>
    </div>
  );
}
