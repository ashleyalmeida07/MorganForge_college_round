"use client";

// Input form generated from a rule set's JSON Schema (`programs.input_schema`).
// Supports what rule sets use: objects, integer / number (min, max), boolean, string (+ enum),
// and arrays of scalars (one value per line or comma separated). Anything else falls back to
// a JSON editor for that field. `validateSchema` reports the same constraints as messages.
import { useId, useState } from "react";

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50";

const typeOf = (s?: JsonSchema) => (Array.isArray(s?.type) ? s?.type.find((t) => t !== "null") : s?.type);
const isScalar = (t?: string) => t === "integer" || t === "number" || t === "string" || t === "boolean";

/** True when the schema can be rendered as a form (an object with known properties). */
export function isFormSchema(schema: unknown): schema is JsonSchema {
  const s = schema as JsonSchema | null;
  return !!s && typeof s === "object" && typeOf(s) === "object" && !!s.properties && Object.keys(s.properties).length > 0;
}

/** A value built from each property's `default` (used when there is no example input). */
export function defaultsFor(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (typeOf(schema) === "object" && schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(schema.properties)) {
      const v = defaultsFor(s);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return undefined;
}

// ------------------------------------------------------------------ validation

export function validateSchema(schema: JsonSchema | null | undefined, value: unknown, path = "input"): string[] {
  if (!schema) return [];
  const t = typeOf(schema);
  const errs: string[] = [];
  const label = path;
  if (value === undefined || value === null) return errs;
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push(`${label} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  switch (t) {
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return [`${label} must be an object`];
      const obj = value as Record<string, unknown>;
      for (const r of schema.required ?? []) {
        if (obj[r] === undefined || obj[r] === null || obj[r] === "") errs.push(`${path}.${r} is required`);
      }
      for (const [k, s] of Object.entries(schema.properties ?? {})) errs.push(...validateSchema(s, obj[k], `${path}.${k}`));
      break;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${label} must be a number`];
      if (t === "integer" && !Number.isInteger(value)) errs.push(`${label} must be a whole number`);
      if (t === "integer" && !Number.isSafeInteger(value)) errs.push(`${label} is too large to represent exactly`);
      if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${label} must be ≥ ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${label} must be ≤ ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errs.push(`${label} must be > ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errs.push(`${label} must be < ${schema.exclusiveMaximum}`);
      break;
    }
    case "string": {
      if (typeof value !== "string") return [`${label} must be text`];
      if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${label} needs ≥ ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${label} allows ≤ ${schema.maxLength} characters`);
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") errs.push(`${label} must be true or false`);
      break;
    case "array": {
      if (!Array.isArray(value)) return [`${label} must be a list`];
      if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${label} needs ≥ ${schema.minItems} item(s)`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${label} allows ≤ ${schema.maxItems} items`);
      value.forEach((v, i) => errs.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
      break;
    }
  }
  return errs;
}

// ------------------------------------------------------------------ fields

interface FieldProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  id: string;
}

function NumberField({ schema, value, onChange, disabled, id }: FieldProps) {
  const integer = typeOf(schema) === "integer";
  // Keep the raw text so intermediate input ("-", "1e") is not clobbered while typing;
  // resync only when the value changes from outside (e.g. switching rule sets).
  const show = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const [text, setText] = useState(show(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (text.trim() === "" ? value !== undefined : Number(text) !== value) setText(show(value));
  }
  return (
    <input
      id={id}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      min={schema.minimum}
      max={schema.maximum}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.trim();
        const n = Number(raw);
        onChange(raw === "" || Number.isNaN(n) ? undefined : n);
      }}
      className={`${FIELD} font-mono`}
    />
  );
}

function ScalarListField({ schema, value, onChange, disabled, id }: FieldProps) {
  const itemType = typeOf(schema.items) ?? "string";
  const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).join(", ") : "");
  const [text, setText] = useState(fmt(value));
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (JSON.stringify(parse(text).value) !== JSON.stringify(value)) {
      setText(fmt(value));
      setErr(null);
    }
  }

  function parse(t: string): { value?: unknown[]; error?: string } {
    const parts = t.split(/[\s,]+/).filter(Boolean);
    if (itemType === "string") return { value: t.split(/\n/).map((s) => s.trim()).filter(Boolean) };
    const nums = parts.map(Number);
    const bad = parts.find((p, i) => !Number.isFinite(nums[i]) || (itemType === "integer" && !Number.isInteger(nums[i])));
    if (bad !== undefined) return { error: `“${bad}” is not ${itemType === "integer" ? "a whole number" : "a number"}` };
    if (itemType === "boolean") return { value: parts.map((p) => p === "true") };
    return { value: nums };
  }

  return (
    <div className="space-y-1">
      <textarea
        id={id}
        rows={Math.min(8, Math.max(2, Math.ceil(text.length / 60)))}
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const r = parse(e.target.value);
          setErr(r.error ?? null);
          if (r.value) onChange(r.value);
        }}
        className={`${FIELD} font-mono`}
      />
      <p className="text-[11px] text-slate-500">
        {err ? <span className="text-red-600">{err}</span> : itemType === "string" ? "One value per line." : "Separate values with commas or spaces."}
      </p>
    </div>
  );
}

function JsonField({ value, onChange, disabled, id }: FieldProps) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <textarea
        id={id}
        rows={4}
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr(null);
          } catch (x) {
            setErr(x instanceof Error ? x.message : "invalid JSON");
          }
        }}
        className={`${FIELD} font-mono`}
      />
      {err && <p className="text-[11px] text-red-600">Invalid JSON: {err}</p>}
    </div>
  );
}

function Field(props: FieldProps & { name: string; required: boolean }) {
  const { schema, value, onChange, disabled, id, name, required } = props;
  const t = typeOf(schema);
  const title = schema.title ?? name;
  const hint = [
    schema.description,
    schema.minimum !== undefined || schema.maximum !== undefined
      ? `${schema.minimum ?? "−∞"} … ${schema.maximum ?? "∞"}`
      : null,
  ].filter(Boolean).join(" · ");

  let control: React.ReactNode;
  if (schema.enum) {
    control = (
      <select
        id={id}
        value={value === undefined ? "" : JSON.stringify(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? undefined : JSON.parse(e.target.value))}
        className={FIELD}
      >
        {!required && <option value="">—</option>}
        {schema.enum.map((opt) => (
          <option key={JSON.stringify(opt)} value={JSON.stringify(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  } else if (t === "integer" || t === "number") {
    control = <NumberField {...props} />;
  } else if (t === "boolean") {
    control = (
      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        {value === true ? "Yes" : "No"}
      </label>
    );
  } else if (t === "string") {
    control = (
      <input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        maxLength={schema.maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    );
  } else if (t === "array" && isScalar(typeOf(schema.items))) {
    control = <ScalarListField {...props} />;
  } else if (t === "object" && schema.properties) {
    control = (
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <ObjectFields schema={schema} value={value} onChange={onChange} disabled={disabled} id={id} />
      </div>
    );
  } else {
    control = <JsonField {...props} />;
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium text-slate-700">
        <span>
          {title}
          {required && <span className="text-red-500"> *</span>}
        </span>
        <code className="text-[11px] font-normal text-slate-400">{name}</code>
      </label>
      {control}
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function ObjectFields({ schema, value, onChange, disabled, id }: FieldProps) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const required = new Set(schema.required ?? []);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Object.entries(schema.properties ?? {}).map(([key, s]) => {
        const wide = typeOf(s) === "array" || typeOf(s) === "object" || !typeOf(s);
        return (
          <div key={key} className={wide ? "sm:col-span-2" : undefined}>
            <Field
              name={key}
              schema={s}
              required={required.has(key)}
              value={obj[key]}
              disabled={disabled}
              id={`${id}-${key}`}
              onChange={(v) => {
                const next = { ...obj };
                if (v === undefined) delete next[key];
                else next[key] = v;
                onChange(next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function SchemaForm({
  schema,
  value,
  onChange,
  disabled,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <ObjectFields schema={schema} value={value} onChange={onChange} disabled={disabled} id={id} />;
}
