export function canonicalize(value) {
  return render(value);
}

function render(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON cannot encode non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => render(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${render(entryValue)}`).join(",")}}`;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}

export function withoutSignature(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("signed value must be an object");
  }
  const { signature: _signature, ...unsigned } = value;
  return unsigned;
}
