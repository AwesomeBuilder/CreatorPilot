"use client";

type StepSidebarProps = {
  steps: string[];
  activeStep: number;
  onSelect: (step: number) => void;
};

export function StepSidebar({ steps, activeStep, onSelect }: StepSidebarProps) {
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const isActive = activeStep === index;

          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold">
                  {index + 1}
                </span>
                {step}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
