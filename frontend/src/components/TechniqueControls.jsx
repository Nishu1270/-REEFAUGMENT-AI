import React from 'react';

export function buildDefaultParams(techniqueMeta) {
  const defaults = {};
  if (!techniqueMeta?.parameters) return defaults;
  techniqueMeta.parameters.forEach((p) => {
    defaults[p.name] = p.default;
  });
  return defaults;
}

export default function TechniqueControls({ techniqueMeta, values, onChange }) {
  if (!techniqueMeta) return null;
  const params = techniqueMeta.parameters || [];

  if (params.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-4 py-3 text-xs text-slate-600">
        This technique operates deterministically with no adjustable numeric parameters.
      </div>
    );
  }

  const updateField = (name, val) => {
    onChange({
      ...values,
      [name]: val,
    });
  };

  return (
    <div className="space-y-4">
      {params.map((spec) => {
        const current = values?.[spec.name] ?? spec.default;

        if (spec.type === 'float' || spec.type === 'int') {
          return (
            <div key={spec.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">{spec.label}</label>
                <span className="inline-flex items-center rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-mono font-semibold text-cyan-800 border border-cyan-100">
                  {current}
                </span>
              </div>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step || (spec.type === 'int' ? 1 : 0.05)}
                value={current}
                onChange={(e) => {
                  const num = spec.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                  updateField(spec.name, num);
                }}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{spec.min}</span>
                {spec.description && <span className="truncate px-2 text-slate-500">{spec.description}</span>}
                <span>{spec.max}</span>
              </div>
            </div>
          );
        }

        if (spec.type === 'select') {
          return (
            <div key={spec.name} className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">{spec.label}</label>
              <select
                value={current}
                onChange={(e) => updateField(spec.name, e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                {(spec.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              {spec.description && <p className="text-[11px] text-slate-500">{spec.description}</p>}
            </div>
          );
        }

        if (spec.type === 'bool') {
          return (
            <label
              key={spec.name}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={Boolean(current)}
                onChange={(e) => updateField(spec.name, e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
              />
              <div>
                <span className="block text-xs font-semibold text-slate-800">{spec.label}</span>
                {spec.description && <span className="block text-[11px] text-slate-500">{spec.description}</span>}
              </div>
            </label>
          );
        }

        return null;
      })}
    </div>
  );
}
