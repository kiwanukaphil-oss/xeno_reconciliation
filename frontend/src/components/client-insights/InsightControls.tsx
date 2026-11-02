// Small building blocks shared by the Client Insights pages

/** Segmented button group used for segment and measure toggles. */
export const ToggleGroup = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        onClick={() => onChange(option.value)}
        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
          value === option.value
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const StatTile = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <div className="bg-white p-5 rounded-lg shadow">
    <p className="text-sm text-gray-600">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    <p className="text-xs text-gray-500 mt-1">{hint}</p>
  </div>
);

/** Thin same-hue bar showing a share (0-1) against a full-width track. */
export const ShareBar = ({ share, widthClass = "w-24" }: { share: number; widthClass?: string }) => (
  <div className={`${widthClass} bg-gray-100 rounded-full h-2`}>
    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
  </div>
);

export const LoadingPanel = ({ message }: { message?: string }) => (
  <div className="flex flex-col items-center justify-center h-64 gap-3">
    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    {message && <p className="text-sm text-gray-500">{message}</p>}
  </div>
);

export const ErrorPanel = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className="p-6">
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <p className="text-red-800">{message}</p>
      <button onClick={onRetry} className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
        Retry
      </button>
    </div>
  </div>
);
