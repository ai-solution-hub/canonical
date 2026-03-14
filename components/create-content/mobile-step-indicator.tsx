'use client';

const FORM_STEPS = [
  { step: 1, label: 'Basics' },
  { step: 2, label: 'Content' },
  { step: 3, label: 'Details' },
] as const;

export interface MobileStepIndicatorProps {
  activeStep: number;
}

/**
 * Mobile-only step indicator for the create content form.
 * Shows progress through Basics, Content, and Details sections.
 */
export function MobileStepIndicator({ activeStep }: MobileStepIndicatorProps) {
  return (
    <nav
      aria-label="Form progress"
      className="mb-6 flex items-center gap-2 sm:hidden"
    >
      {FORM_STEPS.map(({ step, label }, idx) => (
        <div key={step} className="flex items-center gap-2">
          {idx > 0 && (
            <div className="h-px w-4 bg-border" aria-hidden="true" />
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={`flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                activeStep === step
                  ? 'bg-primary text-primary-foreground'
                  : activeStep > step
                    ? 'bg-primary/20 text-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
              aria-current={activeStep === step ? 'step' : undefined}
            >
              {step}
            </span>
            <span
              className={`text-xs font-medium transition-colors ${
                activeStep === step
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {label}
            </span>
          </div>
        </div>
      ))}
    </nav>
  );
}
