import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = new URL("../", import.meta.url);
const schemaPath = new URL("schemas/nem-suite.schema.json", root);
const fixturesPath = new URL("fixtures/valid-records.json", root);
const registriesDir = new URL("registries/", root);

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const fixtures = JSON.parse(await readFile(fixturesPath, "utf8"));

const errors = [];

for (const [name, fixture] of Object.entries(fixtures)) {
  const def = schema.$defs?.[name];
  if (!def) {
    errors.push(`${name}: no matching schema $defs entry`);
    continue;
  }
  validate(fixture, def, name);
}

for (const required of [
  "errorObject",
  "eventEnvelope",
  "run",
  "authorization",
  "checkResult",
  "driverManifest",
  "normalizedStatus",
  "capabilityManifest",
  "preset",
  "registryState",
  "gauntletReport",
  "observation",
  "attentionContract",
  "anomaly",
  "replay"
]) {
  if (!fixtures[required]) {
    errors.push(`fixtures: missing ${required}`);
  }
}

await checkRegistries();
await checkEventRunIdRequirements();

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`contracts ok: ${Object.keys(fixtures).length} fixtures, ${schemaRegistryCount()} schema defs`);

function validate(value, node, at) {
  const resolved = resolve(node);

  if (resolved.allOf) {
    for (const [index, child] of resolved.allOf.entries()) {
      validate(value, child, `${at}.allOf[${index}]`);
    }
  }

  if (resolved.oneOf) {
    const matches = resolved.oneOf.filter((child) => validAgainst(value, child, at));
    if (matches.length !== 1) {
      errors.push(`${at}: expected exactly one oneOf match, got ${matches.length}`);
    }
    return;
  }

  if (resolved.anyOf) {
    const matches = resolved.anyOf.filter((child) => validAgainst(value, child, at));
    if (matches.length < 1) {
      errors.push(`${at}: expected at least one anyOf match`);
    }
  }

  if (resolved.enum && !resolved.enum.some((entry) => deepEqual(entry, value))) {
    errors.push(`${at}: value ${JSON.stringify(value)} is not in enum`);
    return;
  }

  if (resolved.type) {
    const allowed = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
    if (!allowed.some((type) => typeMatches(value, type))) {
      errors.push(`${at}: expected type ${allowed.join("|")}, got ${actualType(value)}`);
      return;
    }
  }

  if (typeof value === "string") {
    if (resolved.minLength !== undefined && value.length < resolved.minLength) {
      errors.push(`${at}: string shorter than ${resolved.minLength}`);
    }
    if (resolved.maxLength !== undefined && value.length > resolved.maxLength) {
      errors.push(`${at}: string longer than ${resolved.maxLength}`);
    }
    if (resolved.pattern && !new RegExp(resolved.pattern).test(value)) {
      errors.push(`${at}: string does not match ${resolved.pattern}`);
    }
    return;
  }

  if (typeof value === "number") {
    if (resolved.minimum !== undefined && value < resolved.minimum) {
      errors.push(`${at}: number below minimum ${resolved.minimum}`);
    }
    if (resolved.maximum !== undefined && value > resolved.maximum) {
      errors.push(`${at}: number above maximum ${resolved.maximum}`);
    }
    if (resolved.exclusiveMinimum !== undefined && value <= resolved.exclusiveMinimum) {
      errors.push(`${at}: number not above exclusiveMinimum ${resolved.exclusiveMinimum}`);
    }
    if (resolved.type === "integer" && !Number.isInteger(value)) {
      errors.push(`${at}: expected integer`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (resolved.minItems !== undefined && value.length < resolved.minItems) {
      errors.push(`${at}: array shorter than ${resolved.minItems}`);
    }
    if (resolved.maxItems !== undefined && value.length > resolved.maxItems) {
      errors.push(`${at}: array longer than ${resolved.maxItems}`);
    }
    if (resolved.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
      errors.push(`${at}: array items are not unique`);
    }
    if (resolved.prefixItems) {
      for (const [index, child] of resolved.prefixItems.entries()) {
        if (index < value.length) {
          validate(value[index], child, `${at}[${index}]`);
        }
      }
      if (resolved.items === false && value.length > resolved.prefixItems.length) {
        errors.push(`${at}: array has items beyond prefixItems`);
      }
    } else if (resolved.items && resolved.items !== false) {
      for (const [index, item] of value.entries()) {
        validate(item, resolved.items, `${at}[${index}]`);
      }
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const required of resolved.required ?? []) {
      if (!(required in value)) {
        errors.push(`${at}: missing required property ${required}`);
      }
    }

    const properties = resolved.properties ?? {};
    for (const [key, childValue] of Object.entries(value)) {
      if (properties[key]) {
        validate(childValue, properties[key], `${at}.${key}`);
      } else if (resolved.additionalProperties === false) {
        errors.push(`${at}: unknown property ${key}`);
      } else if (resolved.additionalProperties && typeof resolved.additionalProperties === "object") {
        validate(childValue, resolved.additionalProperties, `${at}.${key}`);
      }
    }

    if (resolved.minProperties !== undefined && Object.keys(value).length < resolved.minProperties) {
      errors.push(`${at}: object has fewer than ${resolved.minProperties} properties`);
    }
  }
}

function validAgainst(value, node, at) {
  const before = errors.length;
  validate(value, node, at);
  const valid = errors.length === before;
  errors.splice(before);
  return valid;
}

function resolve(node) {
  if (!node?.$ref) {
    return node;
  }
  if (!node.$ref.startsWith("#/$defs/")) {
    throw new Error(`unsupported $ref ${node.$ref}`);
  }
  const name = node.$ref.slice("#/$defs/".length);
  const resolved = schema.$defs?.[name];
  if (!resolved) {
    throw new Error(`unresolved $ref ${node.$ref}`);
  }
  return resolved;
}

function typeMatches(value, type) {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

function actualType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function checkRegistries() {
  const files = (await readdir(registriesDir))
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const registry = JSON.parse(await readFile(new URL(file, registriesDir), "utf8"));
    if (registry.suite_version !== "0.2.1") {
      errors.push(`${file}: suite_version must be 0.2.1`);
    }
    if (!registry.registry) {
      errors.push(`${file}: missing registry name`);
    }
    const valueKeys = ["values", "action_spaces", "safe_state_kinds"].filter((key) => key in registry);
    if (valueKeys.length === 0) {
      errors.push(`${file}: missing registry values`);
    }
    for (const key of valueKeys) {
      const entries = registry[key];
      if (!Array.isArray(entries) || entries.length === 0) {
        errors.push(`${file}: ${key} must be a non-empty array`);
      }
      const seen = new Set();
      for (const entry of entries) {
        const id = typeof entry === "string" ? entry : entry.code ?? entry.name ?? JSON.stringify(entry);
        if (seen.has(id)) {
          errors.push(`${file}: duplicate registry value ${id}`);
        }
        seen.add(id);
      }
    }
    if (file === "event-types.json") {
      checkEventTypeRegistry(registry);
    }
  }
}

async function checkEventRunIdRequirements() {
  const registry = JSON.parse(await readFile(new URL("event-types.json", registriesDir), "utf8"));
  const eventTypes = new Map(registry.values.map((entry) => [entry.name ?? entry, entry]));
  const events = [
    ["fixtures.eventEnvelope", fixtures.eventEnvelope],
    ...(fixtures.replay?.events ?? []).map((event, index) => [`fixtures.replay.events[${index}]`, event])
  ];
  for (const [at, event] of events) {
    const meta = eventTypes.get(event.event_type);
    if (!meta) {
      errors.push(`${at}: event_type ${event.event_type} is not registered`);
      continue;
    }
    if (meta.run_id_required && !event.run_id) {
      errors.push(`${at}: event_type ${event.event_type} requires run_id by registry`);
    }
  }
}

function checkEventTypeRegistry(registry) {
  for (const [index, entry] of registry.values.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`event-types.json: values[${index}] must be an object with run_id metadata`);
      continue;
    }
    if (typeof entry.name !== "string" || !/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(entry.name)) {
      errors.push(`event-types.json: values[${index}].name is invalid`);
    }
    if (typeof entry.run_id_required !== "boolean") {
      errors.push(`event-types.json: ${entry.name}.run_id_required must be boolean`);
    }
    if (typeof entry.physical_consequence !== "boolean") {
      errors.push(`event-types.json: ${entry.name}.physical_consequence must be boolean`);
    }
    if (entry.physical_consequence && !entry.run_id_required) {
      errors.push(`event-types.json: ${entry.name} is physical but does not require run_id`);
    }
  }
}

function schemaRegistryCount() {
  return Object.keys(schema.$defs ?? {}).length;
}
