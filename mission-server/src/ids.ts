let counter = 0;

export function makeId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}`;
}
