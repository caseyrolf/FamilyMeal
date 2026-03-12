const http = require("http");
const { readFile, writeFile, mkdir, access } = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value)
    ? value
    : path.resolve(process.cwd(), value);
}

const DATA_DIR = resolveConfiguredPath(
  process.env.FAMILY_MEAL_DATA_DIR,
  path.join(__dirname, "..", "data")
);
const DATA_FILE = resolveConfiguredPath(
  process.env.FAMILY_MEAL_DATA_FILE,
  path.join(DATA_DIR, "family_meals.json")
);
const EXPORT_DIR = resolveConfiguredPath(
  process.env.FAMILY_MEAL_EXPORT_DIR,
  path.join(DATA_DIR, "exports")
);
const CLIENT_DIR = path.join(__dirname, "..", "client");

const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Access-Token",
};

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DATA_FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeFile(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
    } else {
      throw err;
    }
  }
}

async function loadData() {
  await ensureDataFile();
  const raw = await readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function saveData(data) {
  await ensureDataFile();
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function respondJson(res, status, payload) {
  const headers = {
    ...DEFAULT_HEADERS,
    "Content-Type": "application/json",
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function respondText(res, status, text, additionalHeaders = {}) {
  res.writeHead(status, { ...DEFAULT_HEADERS, ...additionalHeaders });
  res.end(text);
}

function respondBuffer(res, status, buffer, additionalHeaders = {}) {
  res.writeHead(status, { ...DEFAULT_HEADERS, ...additionalHeaders });
  res.end(buffer);
}

async function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function getToken(req) {
  const header = req.headers["x-access-token"];
  if (typeof header !== "string" || header.trim().length === 0) {
    return null;
  }
  return header.trim();
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function normalizeText(value) {
  return value ? decodeHtmlEntities(String(value)).trim() : "";
}

const HTML_ENTITY_MAP = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  frac14: "1/4",
  frac12: "1/2",
  frac34: "3/4",
};

function decodeHtmlEntities(value) {
  if (!value || !value.includes("&")) return value || "";
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, normalized)
      ? HTML_ENTITY_MAP[normalized]
      : match;
  });
}

function normalizeCategories(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((item) => normalizeText(item).toLowerCase())
      .filter((item) => item.length > 0);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((item) => normalizeText(item).toLowerCase())
      .filter((item) => item.length > 0);
  }
  return [];
}

const UNIT_MAP = {
  teaspoons: "tsp",
  teaspoon: "tsp",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  pound: "lb",
  pounds: "lb",
  lb: "lb",
  lbs: "lb",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  clove: "clove",
  cloves: "clove",
  pinch: "pinch",
  pinches: "pinch",
  stick: "stick",
  sticks: "stick",
};

function parseQuantityText(text) {
  const fractionRegex = /^(\d+)\s+(\d+)\/(\d+)$/;
  const simpleFraction = /^(\d+)\/(\d+)$/;
  const hyphenFraction = /^(\d+)-(\d+)\/(\d+)$/;
  if (!text) return null;
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }
  const hyphenMatch = trimmed.match(hyphenFraction);
  if (hyphenMatch) {
    const whole = parseInt(hyphenMatch[1], 10);
    const numerator = parseInt(hyphenMatch[2], 10);
    const denominator = parseInt(hyphenMatch[3], 10);
    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }
  const fractionMatch = trimmed.match(fractionRegex);
  if (fractionMatch) {
    const whole = parseInt(fractionMatch[1], 10);
    const numerator = parseInt(fractionMatch[2], 10);
    const denominator = parseInt(fractionMatch[3], 10);
    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }
  const simpleMatch = trimmed.match(simpleFraction);
  if (simpleMatch) {
    const numerator = parseInt(simpleMatch[1], 10);
    const denominator = parseInt(simpleMatch[2], 10);
    if (denominator !== 0) {
      return numerator / denominator;
    }
  }
  const decimal = Number.parseFloat(trimmed);
  if (!Number.isNaN(decimal)) {
    return decimal;
  }
  return null;
}

function tokenizeIngredient(line) {
  if (!line) {
    return {
      original: "",
      quantity: null,
      unit: null,
      ingredient: "",
      notes: "",
    };
  }
  const original = normalizeUnicodeFractions(normalizeText(line));
  const tokens = original.split(/\s+/);
  const maybeQuantity = tokens[0];
  let quantity = parseQuantityText(maybeQuantity);
  let unit = null;
  let startIndex = 0;
  if (quantity !== null) {
    startIndex = 1;
    if (tokens.length > startIndex) {
      const potentialFraction = parseQuantityText(tokens[startIndex]);
      if (
        potentialFraction !== null &&
        /\/|\d+-\d+\//.test(tokens[startIndex])
      ) {
        quantity += potentialFraction;
        startIndex += 1;
      }
    }
    if (tokens.length > startIndex) {
      const nextToken = tokens[startIndex].toLowerCase();
      const normalized = UNIT_MAP[nextToken];
      if (normalized) {
        unit = normalized;
        startIndex += 1;
      }
    }
  }
  const ingredientParts = tokens.slice(startIndex);
  let ingredient = ingredientParts.join(" ");
  let notes = "";
  const noteMatch = ingredient.match(/\(([^)]+)\)$/);
  if (noteMatch) {
    notes = noteMatch[1];
    ingredient = ingredient.replace(/\(([^)]+)\)$/, "").trim();
  }
  return {
    original,
    quantity,
    unit,
    ingredient: ingredient.trim(),
    notes,
  };
}

function coerceQuantity(value, fallback) {
  if (value === null || typeof value === "undefined" || value === "") {
    return fallback;
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function summarizeInstructions(instructions) {
  if (Array.isArray(instructions)) {
    return instructions
      .map((step) => {
        if (typeof step === "string") {
          return normalizeText(step);
        }
        if (step && typeof step.text === "string") {
          return normalizeText(step.text);
        }
        return null;
      })
      .filter(Boolean);
  }
  if (typeof instructions === "string") {
    return instructions
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter((line) => line.length > 0);
  }
  return [];
}

function summarizeIngredients(ingredients) {
  if (!ingredients) return [];
  if (Array.isArray(ingredients)) {
    return ingredients
      .map((item) => {
        if (typeof item === "string") return normalizeText(item);
        if (item && typeof item.text === "string") return normalizeText(item.text);
        return null;
      })
      .filter(Boolean);
  }
  if (typeof ingredients === "string") {
    return ingredients
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter((line) => line.length > 0);
  }
  return [];
}

function pickFirstRecipe(jsonLd) {
  if (!jsonLd) return null;
  const records = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  for (const record of records) {
    if (!record) continue;
    if (Array.isArray(record["@graph"])) {
      const graphMatch = record["@graph"].find((item) => {
        if (!item) return false;
        const type = item["@type"];
        if (Array.isArray(type)) {
          return type.includes("Recipe");
        }
        return type === "Recipe";
      });
      if (graphMatch) return graphMatch;
    }
    const type = record["@type"];
    if (Array.isArray(type)) {
      if (type.includes("Recipe")) {
        return record;
      }
    } else if (type === "Recipe") {
      return record;
    }
  }
  return null;
}

function extractJsonLd(html) {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      matches.push(parsed);
    } catch (err) {
      // Some pages embed multiple JSON objects without wrapping array.
      const wrappedRaw = `[${raw
        .split("\n")
        .map((line) => normalizeText(line))
        .filter((line) => line.length > 0)
        .join("")}]`;
      try {
        const fallbackParsed = JSON.parse(wrappedRaw);
        matches.push(fallbackParsed);
      } catch {
        // ignore broken block
      }
    }
  }
  return matches;
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return normalizeText(titleMatch[1]);
  }
  return "Untitled Recipe";
}

function fallbackParse(html) {
  const name = extractTitle(html);
  const ingredientMatches = collectTextMatches(html, [
    /<li[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
    /<li[^>]*class=["'][^"']*mntl-structured-ingredients__list-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
    /<span[^>]*class=["'][^"']*recipe-ingred_txt[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<p[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  ]);
  const stepMatches = collectTextMatches(html, [
    /<li[^>]*class=["'][^"']*(instruction|direction|step)[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
    /<li[^>]*class=["'][^"']*mntl-structured-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
    /<li[^>]*class=["'][^"']*mntl-sc-block-group--LI[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
    /<div[^>]*class=["'][^"']*recipe-directions__list--item[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class=["'][^"']*(instruction|step)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  ]);
  const nutritionMatches = collectNutritionFromHtml(html);
  return {
    name,
    ingredients: ingredientMatches,
    steps: stepMatches,
    nutrition: nutritionMatches,
  };
}

function stripTags(value) {
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2f;/gi, "/")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function withGlobal(regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

function collectTextMatches(html, patterns) {
  const results = [];
  const seen = new Set();
  for (const pattern of patterns) {
    const regex = withGlobal(pattern);
    let match;
    while ((match = regex.exec(html)) !== null) {
      const possibleGroups = match.slice(1).filter(Boolean);
      const raw = possibleGroups.length > 0 ? possibleGroups[0] : match[0];
      const text = stripTags(raw);
      if (text && !seen.has(text)) {
        seen.add(text);
        results.push(text);
      }
    }
  }
  return results;
}

const UNICODE_FRACTIONS = new Map([
  ["¼", "1/4"],
  ["½", "1/2"],
  ["¾", "3/4"],
  ["⅐", "1/7"],
  ["⅑", "1/9"],
  ["⅒", "1/10"],
  ["⅓", "1/3"],
  ["⅔", "2/3"],
  ["⅕", "1/5"],
  ["⅖", "2/5"],
  ["⅗", "3/5"],
  ["⅘", "4/5"],
  ["⅙", "1/6"],
  ["⅚", "5/6"],
  ["⅛", "1/8"],
  ["⅜", "3/8"],
  ["⅝", "5/8"],
  ["⅞", "7/8"],
]);

function normalizeUnicodeFractions(value) {
  if (!value) return value;
  let result = value;
  for (const [char, replacement] of UNICODE_FRACTIONS.entries()) {
    if (!result.includes(char)) continue;
    const escaped = char.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const adjacentDigitRegex = new RegExp(`(\\d)${escaped}`, "g");
    result = result.replace(adjacentDigitRegex, (_, digit) => `${digit} ${replacement}`);
    const standaloneRegex = new RegExp(escaped, "g");
    result = result.replace(standaloneRegex, replacement);
  }
  return result;
}

const NOISE_LINE_PATTERNS = [
  /^keep screen awake$/i,
  /^jump to recipe$/i,
  /^pin recipe$/i,
  /^print recipe$/i,
  /^rate(?: this)? recipe$/i,
  /^add to shopping list$/i,
  /^leave a review$/i,
  /^log in$/i,
  /^ad:?$/i,
  /^advertisement$/i,
  /^save recipe$/i,
  /^share$/i,
  /^email$/i,
  /^text$/i,
  /^facebook$/i,
  /^pinterest$/i,
  /^review$/i,
  /^related$/i,
  /^from the editor$/i,
  /^nutrition data/i,
  /^recipe image$/i,
  /^nutrition label$/i,
  /^notes$/i,
];

function isNoiseLine(line) {
  if (!line) return true;
  const trimmed = line.trim();
  if (!trimmed) return true;
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeSectionLine(line) {
  return normalizeText(line)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*{1,2}\s*/, "")
    .replace(/^_{1,2}\s*/, "")
    .trim();
}

function chooseTitle(lines) {
  for (const line of lines) {
    if (!line) continue;
    const cleaned = normalizeSectionLine(line).replace(/^[•\-\s]+/, "").trim();
    if (!cleaned) continue;
    if (
      /^(ingredients|directions|instructions|method|preparation|steps|description|summary|nutrition)\b/i.test(
        cleaned
      )
    ) {
      continue;
    }
    if (isNoiseLine(cleaned)) continue;
    return cleaned;
  }
  return "Untitled Recipe";
}

const NUTRITION_KEY_LABELS = {
  calories: "Calories",
  carbohydrateContent: "Carbohydrates",
  fatContent: "Fat",
  fiberContent: "Fiber",
  proteinContent: "Protein",
  sodiumContent: "Sodium",
  sugarContent: "Sugar",
  cholesterolContent: "Cholesterol",
  transFatContent: "Trans Fat",
  saturatedFatContent: "Saturated Fat",
  unsaturatedFatContent: "Unsaturated Fat",
  servingSize: "Serving Size",
  servingSizeInGrams: "Serving Size",
};

function splitNutritionLine(raw) {
  const line = normalizeText(raw);
  if (!line) return { label: "", value: "" };
  const colonMatch = line.match(/^([^:]+?):\s*(.+)$/);
  if (colonMatch) {
    return { label: colonMatch[1], value: colonMatch[2] };
  }
  const dashMatch = line.match(/^(.+?)[\s\-–—]+\s*(.+)$/);
  if (dashMatch) {
    return { label: dashMatch[1], value: dashMatch[2] };
  }
  const caloriesMatch = line.match(/^(\d+\s*(cal2?|calories|kcal).*)$/i);
  if (caloriesMatch) {
    return { label: "Calories", value: caloriesMatch[1] };
  }
  return { label: "", value: line };
}

function splitCompoundNutritionLine(raw) {
  const line = normalizeText(raw);
  if (!line) return [];
  const segments = line
    .split(/\s*[|•]\s*/)
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  return segments.length > 1 ? segments : [line];
}

function normalizeNutritionEntries(input) {
  if (!input) return [];
  const entries = [];
  const seen = new Set();

  const pushEntry = (label, value) => {
    const cleanLabel = normalizeText(label);
    const cleanValue = normalizeText(value);
    if (!cleanLabel && !cleanValue) return;
    const key = `${cleanLabel}::${cleanValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ label: cleanLabel, value: cleanValue });
  };

  const handleItem = (item) => {
    if (!item) return;
    if (typeof item === "string") {
      splitCompoundNutritionLine(item).forEach((segment) => {
        const { label, value } = splitNutritionLine(segment);
        pushEntry(label, value);
      });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(handleItem);
      return;
    }
    if (typeof item === "object") {
      if (item.label || item.name || item.title || item.headline) {
        const label =
          item.label || item.name || item.title || item.headline || "";
        const value = item.value || item.amount || item.text || item.description || "";
        pushEntry(label, value);
        return;
      }
      Object.entries(item).forEach(([key, value]) => {
        if (key === "@type") return;
        const mappedLabel =
          NUTRITION_KEY_LABELS[key] ||
          key
            .replace(/Content$/i, "")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/\b\w/g, (char) => char.toUpperCase());
        if (value && typeof value === "object") {
          handleItem({
            label: mappedLabel,
            value:
              value.value || value.text || value.amount || JSON.stringify(value),
          });
        } else {
          pushEntry(mappedLabel, value);
        }
      });
    }
  };

  handleItem(input);
  return entries;
}

function attachNutritionIds(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    id: normalizeText(entry.id) || crypto.randomUUID(),
    label: normalizeText(entry.label),
    value: normalizeText(entry.value),
  }));
}

function cleanIngredientLine(line) {
  if (!line) return "";
  let result = line;
  result = result.replace(/^\(?ingredient\s*\d+:?\)?\s*/i, "");
  result = result.replace(/^[\s•·*\-–—]+/, "");
  result = result.replace(/^\(\d+\)\s*/, "");
  result = result.replace(/^\d+\.\s*/, "");
  result = result.replace(/^\d+\)\s*/, "");
  result = result.replace(/^\d+\s*[-–]\s*/, "");
  return result.trim();
}

function cleanStepLine(line) {
  if (!line) return "";
  let result = line;
  result = result.replace(/^(step\s*\d+:?\s*)/i, "");
  result = result.replace(/^[\s•·*\-–—]+/, "");
  result = result.replace(/^\(\d+\)\s*/, "");
  result = result.replace(/^\d+\.\s*/, "");
  result = result.replace(/^\d+\)\s*/, "");
  result = result.replace(/^\d+\s*[-–]\s*/, "");
  return result.trim();
}

function cleanNutritionLine(line) {
  if (!line) return "";
  let result = line;
  result = result.replace(/^\(?nutrition\s*\d*:?\)?\s*/i, "");
  result = result.replace(/^[\s•·*\-–—]+/, "");
  result = result.replace(/^\(\d+\)\s*/, "");
  result = result.replace(/^\d+\.\s*/, "");
  result = result.replace(/^\d+\)\s*/, "");
  result = result.replace(/^\d+\s*[-–]\s*/, "");
  return result.trim();
}

const INGREDIENT_STOP_WORDS = new Set([
  "fresh",
  "freshly",
  "finely",
  "coarsely",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "ground",
  "boneless",
  "skinless",
  "large",
  "small",
  "medium",
  "extra",
  "virgin",
  "extra-virgin",
  "kosher",
  "to",
  "taste",
  "and",
  "or",
  "divided",
  "halved",
  "quartered",
  "peeled",
  "seeded",
  "room",
  "temperature",
  "softened",
  "melted",
  "optional",
  "such",
  "as",
  "plus",
  "more",
  "for",
  "serving",
  "roughly",
  "lightly",
  "packed",
  "the",
  "a",
  "an",
  "of",
  "with",
  "about",
  "cold",
  "warm",
  "hot",
  "thawed",
  "unsalted",
  "salted",
  "refrigerated",
  "room-temperature",
]);

function singularizeToken(token) {
  if (token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function canonicalizeIngredientName(name) {
  if (!name) return "";
  let base = name.toLowerCase();
  base = base.replace(/\([^)]*\)/g, " ");
  base = base.replace(/[,/&+-]+/g, " ");
  base = base.replace(/\s+/g, " ").trim();
  if (!base) return "";
  const tokens = base
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => singularizeToken(token))
    .filter((token) => !INGREDIENT_STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return base;
  }
  return tokens.join(" ");
}

function normalizeIngredientEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return tokenizeIngredient(entry);
  }
  if (typeof entry === "object") {
    if (entry.original) {
      const parsed = tokenizeIngredient(entry.original);
      return {
        ...parsed,
        quantity:
          typeof entry.quantity !== "undefined" && entry.quantity !== null
            ? coerceQuantity(entry.quantity, parsed.quantity)
            : parsed.quantity,
        unit: entry.unit || parsed.unit,
        ingredient: (entry.ingredient || parsed.ingredient || "").trim(),
        notes: entry.notes || parsed.notes,
        original: entry.original,
      };
    }
    if (entry.ingredient) {
      return {
        original: entry.original || entry.ingredient,
        ingredient: entry.ingredient.trim(),
        unit: entry.unit || null,
        quantity: coerceQuantity(entry.quantity, null),
        notes: entry.notes || "",
      };
    }
  }
  return null;
}

function collectNutritionFromHtml(html) {
  const rows = [];
  const tableRowRegex =
    /<tr[^>]*class=["'][^"']*nutrition[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = tableRowRegex.exec(html)) !== null) {
    const row = match[1];
    const labelMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    const valueMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    const label = labelMatch ? stripTags(labelMatch[1]) : "";
    const value = valueMatch ? stripTags(valueMatch[1]) : "";
    if (label || value) {
      rows.push({ label, value });
    }
  }

  const summaryRegex =
    /<div[^>]*class=["'][^"']*nutrition-facts-summary__item[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  while ((match = summaryRegex.exec(html)) !== null) {
    const block = match[1];
    const labelMatch = block.match(
      /<span[^>]*class=["'][^"']*(label|name)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    const valueMatch = block.match(
      /<span[^>]*class=["'][^"']*(value|amount)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    const label = labelMatch ? stripTags(labelMatch[2] || labelMatch[1]) : "";
    const value = valueMatch ? stripTags(valueMatch[2] || valueMatch[1]) : "";
    if (label || value) {
      rows.push({ label, value });
    }
  }

  const listRegex =
    /<li[^>]*class=["'][^"']*nutrition[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  while ((match = listRegex.exec(html)) !== null) {
    const item = stripTags(match[1]);
    if (item) {
      rows.push(item);
    }
  }

  return normalizeNutritionEntries(rows);
}

function buildRecipeProxyUrl(targetUrl) {
  return `https://r.jina.ai/http://${targetUrl.host}${targetUrl.pathname}${
    targetUrl.search || ""
  }`;
}

async function fetchRecipeProxyText(url) {
  const targetUrl = new URL(url);
  const proxyResponse = await fetch(buildRecipeProxyUrl(targetUrl), {
    headers: {
      Accept: "text/plain",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    },
    redirect: "follow",
  });
  if (!proxyResponse.ok) {
    return null;
  }
  return proxyResponse.text();
}

async function fetchRecipeDocument(url) {
  const targetUrl = new URL(url);
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua":
      '"Chromium";v="123", "Not:A-Brand";v="8", "Google Chrome";v="123"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
  headers.Referer = "https://www.google.com/";

  const candidates = new Set();
  candidates.add(url);
  if (!targetUrl.searchParams.has("print")) {
    candidates.add(`${targetUrl.origin}${targetUrl.pathname}?print`);
    candidates.add(`${targetUrl.origin}${targetUrl.pathname}?print=1`);
  }
  if (!targetUrl.searchParams.has("output")) {
    candidates.add(`${targetUrl.origin}${targetUrl.pathname}?output=1`);
  }

  let lastStatus = null;
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers,
      redirect: "follow",
    });
    lastStatus = response.status;
    if (response.ok) {
      const html = await response.text();
      return { content: html, isProxy: false };
    }
    if (response.status !== 403 && response.status !== 451 && response.status !== 406) {
      break;
    }
  }

  const proxyText = await fetchRecipeProxyText(url);
  if (proxyText) {
    return { content: proxyText, isProxy: true };
  }
  throw new Error(
    `Unable to fetch recipe (status ${
      lastStatus ?? proxyResponse.status
    })`
  );
}

function findSectionStart(lines, pattern, startIndex = 0) {
  for (let i = Math.max(0, startIndex); i < lines.length; i += 1) {
    if (pattern.test(normalizeSectionLine(lines[i]))) {
      return i;
    }
  }
  return -1;
}

function parsePlainTextRecipe(text) {
  const emptyResult = {
    name: "Untitled Recipe",
    ingredients: [],
    steps: [],
    notes: "",
    nutrition: [],
  };
  if (!text) return emptyResult;

  const normalized = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 0 && !/^(Advertisement|Ad:)/i.test(line));

  if (normalized.length === 0) return emptyResult;

  const title = chooseTitle(normalized);
  const ingredientsStart = findSectionStart(normalized, /^ingredients\b/i);
  const stepsStart = findSectionStart(
    normalized,
    /^(directions|instructions|method|preparation|steps)\b/i,
    ingredientsStart !== -1 ? ingredientsStart + 1 : 0
  );
  const sectionSearchStart =
    stepsStart !== -1
      ? stepsStart + 1
      : ingredientsStart !== -1
        ? ingredientsStart + 1
        : 0;
  const notesStart = findSectionStart(
    normalized,
    /^(notes?|tips|serving suggestions|cook's note|make ahead|storage)\b/i,
    sectionSearchStart
  );
  const nutritionStart = findSectionStart(
    normalized,
    /^(nutrition facts?|nutrition information|nutrition)(?!\s+label)\b/i,
    sectionSearchStart
  );

  const ingredientLines = [];
  if (ingredientsStart !== -1) {
    for (let i = ingredientsStart + 1; i < normalized.length; i += 1) {
      const line = normalized[i];
      if (
        /^(directions|instructions|method|preparation|steps)\b/i.test(normalizeSectionLine(line))
      ) {
        break;
      }
      const cleaned = normalizeUnicodeFractions(cleanIngredientLine(line));
      if (cleaned.length > 0) {
        ingredientLines.push(cleaned);
      }
      if (stepsStart !== -1 && i + 1 >= stepsStart) break;
    }
  }

  const stepLines = [];
  if (stepsStart !== -1) {
    for (let i = stepsStart + 1; i < normalized.length; i += 1) {
      const line = normalized[i];
      if (
        /^(nutrition|notes?|tips|serving suggestions|cook's note|make ahead|storage|video)\b/i.test(
          normalizeSectionLine(line)
        )
      ) {
        break;
      }
      const cleaned = normalizeUnicodeFractions(cleanStepLine(line));
      if (cleaned.length > 0) {
        stepLines.push(cleaned);
      }
    }
  }

  const noteLines = [];
  if (notesStart !== -1) {
    for (let i = notesStart + 1; i < normalized.length; i += 1) {
      const line = normalized[i];
      if (
        /^(ingredients|directions|instructions|method|preparation|steps|nutrition facts?|nutrition information|nutrition|video)\b/i.test(
          normalizeSectionLine(line)
        )
      ) {
        break;
      }
      const cleaned = normalizeUnicodeFractions(cleanStepLine(line));
      if (cleaned.length > 0) {
        noteLines.push(cleaned);
      }
    }
  }

  const nutritionLines = [];
  if (nutritionStart !== -1) {
    for (let i = nutritionStart + 1; i < normalized.length; i += 1) {
      const line = normalized[i];
      if (
        /^(ingredients|directions|instructions|method|preparation|steps|notes?|tips|serving suggestions|cook's note|make ahead|storage|video)\b/i.test(
          normalizeSectionLine(line)
        )
      ) {
        break;
      }
      const cleaned = normalizeUnicodeFractions(cleanNutritionLine(line));
      if (cleaned.length > 0) {
        nutritionLines.push(cleaned);
      }
    }
  }

  return {
    name: title || emptyResult.name,
    ingredients: ingredientLines,
    steps: stepLines,
    notes: noteLines.join("\n").trim(),
    nutrition: normalizeNutritionEntries(nutritionLines),
  };
}

function htmlToTextForSectionParsing(html) {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/(p|div|section|article|header|footer|h1|h2|h3|h4|h5|h6|ul|ol|li|tr|table)>/gi,
        "\n"
      )
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => normalizeText(line.replace(/^•\s*/, "• ")))
    .filter((line) => line.length > 0)
    .join("\n");
}

function mergeRecipeParse(primary, fallback) {
  const primaryIngredients = Array.isArray(primary?.ingredients)
    ? primary.ingredients
    : [];
  const fallbackIngredients = Array.isArray(fallback?.ingredients)
    ? fallback.ingredients
    : [];
  const primarySteps = Array.isArray(primary?.steps) ? primary.steps : [];
  const fallbackSteps = Array.isArray(fallback?.steps) ? fallback.steps : [];
  const primaryNutrition = Array.isArray(primary?.nutrition)
    ? primary.nutrition
    : [];
  const fallbackNutrition = Array.isArray(fallback?.nutrition)
    ? fallback.nutrition
    : [];

  return {
    name:
      normalizeText(primary?.name) ||
      normalizeText(fallback?.name) ||
      "Untitled Recipe",
    description:
      normalizeText(primary?.description) || normalizeText(fallback?.description),
    author: normalizeText(primary?.author) || normalizeText(fallback?.author),
    ingredients: primaryIngredients.length ? primaryIngredients : fallbackIngredients,
    steps: primarySteps.length ? primarySteps : fallbackSteps,
    categories: Array.isArray(primary?.categories) ? primary.categories : [],
    totalTime:
      normalizeText(primary?.totalTime) || normalizeText(fallback?.totalTime),
    yield: normalizeText(primary?.yield) || normalizeText(fallback?.yield),
    notes: normalizeText(primary?.notes) || normalizeText(fallback?.notes),
    nutrition: primaryNutrition.length ? primaryNutrition : fallbackNutrition,
  };
}

async function scrapeRecipe(url) {
  const { content, isProxy } = await fetchRecipeDocument(url);
  if (isProxy) {
    const parsed = parsePlainTextRecipe(content);
    if (
      parsed.ingredients.length ||
      parsed.steps.length ||
      parsed.notes ||
      (parsed.nutrition && parsed.nutrition.length)
    ) {
      return {
        name: parsed.name || "Untitled Recipe",
        description: "",
        author: "",
        ingredients: parsed.ingredients,
        steps: parsed.steps,
        categories: [],
        totalTime: "",
        yield: "",
        notes: parsed.notes || "",
        nutrition: parsed.nutrition || [],
      };
    }
  }

  const html = content;
  const htmlFallback = fallbackParse(html);
  const textFallback = parsePlainTextRecipe(htmlToTextForSectionParsing(html));
  let proxyFallback = null;
  if (!isProxy && /\/wprm_print\//i.test(url)) {
    const proxyText = await fetchRecipeProxyText(url);
    if (proxyText) {
      proxyFallback = parsePlainTextRecipe(proxyText);
    }
  }
  const fallback = {
    ...htmlFallback,
    notes: proxyFallback?.notes || textFallback.notes || "",
    steps:
      proxyFallback?.steps?.length
        ? proxyFallback.steps
        : textFallback.steps && textFallback.steps.length
          ? textFallback.steps
          : htmlFallback.steps,
    ingredients:
      proxyFallback?.ingredients?.length
        ? proxyFallback.ingredients
        : textFallback.ingredients && textFallback.ingredients.length
          ? textFallback.ingredients
          : htmlFallback.ingredients,
    nutrition:
      proxyFallback?.nutrition?.length
        ? proxyFallback.nutrition
        : textFallback.nutrition && textFallback.nutrition.length
          ? textFallback.nutrition
          : htmlFallback.nutrition || [],
  };

  const jsonLdBlocks = extractJsonLd(html);
  for (const block of jsonLdBlocks) {
    const recipe = pickFirstRecipe(block);
    if (!recipe) continue;
    const merged = mergeRecipeParse(
      {
        name:
          normalizeText(recipe.name) ||
          normalizeText(recipe.headline) ||
          extractTitle(html),
        description: normalizeText(recipe.description),
        author: normalizeText(
          typeof recipe.author === "string"
            ? recipe.author
            : recipe.author?.name
        ),
        ingredients: summarizeIngredients(recipe.recipeIngredient),
        steps: summarizeInstructions(recipe.recipeInstructions),
        categories: normalizeCategories(
          recipe.recipeCategory || recipe.keywords
        ),
        totalTime: normalizeText(recipe.totalTime),
        yield: normalizeText(recipe.recipeYield),
        nutrition: normalizeNutritionEntries(recipe.nutrition),
      },
      fallback
    );
    if (
      merged.name ||
      merged.ingredients.length ||
      merged.steps.length ||
      merged.notes ||
      merged.nutrition.length
    ) {
      return merged;
    }
  }

  return {
    ...fallback,
    nutrition: fallback.nutrition || [],
    notes: fallback.notes || "",
  };
}

function ensureUser(data, token, { createIfMissing = false } = {}) {
  const users = data.users || (data.users = {});
  let user = users[token];
  if (!user && createIfMissing) {
    user = {
      createdAt: new Date().toISOString(),
      recipes: [],
      metadata: {},
    };
    users[token] = user;
  }
  return user;
}

function requireUser(req, res, data) {
  const token = getToken(req);
  if (!token) {
    respondJson(res, 401, { error: "Missing access token" });
    return null;
  }
  const user = ensureUser(data, token);
  if (!user) {
    respondJson(res, 404, { error: "No recipe list found for this password" });
    return null;
  }
  return { token, user };
}

function buildRecipePayload(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid recipe payload");
  }
  const id = normalizeText(raw.id) || crypto.randomUUID();
  const name = normalizeText(raw.name);
  const url = normalizeText(raw.url);
  const categories = normalizeCategories(raw.categories);
  const rawIngredients = Array.isArray(raw.ingredients)
    ? raw.ingredients
    : [];
  const ingredients = rawIngredients.map((entry) => {
    if (entry && typeof entry === "object") {
      const explicitOriginal = normalizeText(entry.original);
      const synthesizedLine =
        explicitOriginal ||
        [entry.quantity, entry.unit, entry.ingredient]
          .map((value) => normalizeText(value))
          .filter((value) => value.length > 0)
          .join(" ");
      const parsed = tokenizeIngredient(synthesizedLine);
      return {
        id: normalizeText(entry.id) || crypto.randomUUID(),
        original: synthesizedLine,
        quantity: coerceQuantity(entry.quantity, parsed.quantity),
        unit: normalizeText(entry.unit) || parsed.unit,
        ingredient:
          normalizeText(entry.ingredient) || parsed.ingredient,
        notes: normalizeText(entry.notes) || parsed.notes,
      };
    }
    if (typeof entry === "string") {
      const parsed = tokenizeIngredient(entry);
      return {
        id: crypto.randomUUID(),
        ...parsed,
      };
    }
    return {
      id: crypto.randomUUID(),
      ...tokenizeIngredient(""),
    };
  });
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = stepsRaw
    .map((step) => normalizeText(step))
    .filter((step) => step.length > 0);

  const rawNutrition = Array.isArray(raw.nutrition)
    ? raw.nutrition
    : [];
  const nutrition = rawNutrition
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const label =
          normalizeText(entry.label) ||
          normalizeText(entry.name) ||
          normalizeText(entry.title);
        const value =
          normalizeText(entry.value) ||
          normalizeText(entry.amount) ||
          normalizeText(entry.text);
        if (!label && !value) return null;
        return {
          id: normalizeText(entry.id) || crypto.randomUUID(),
          label,
          value,
        };
      }
      if (typeof entry === "string") {
        const { label, value } = splitNutritionLine(entry);
        if (!label && !value) return null;
        return {
          id: crypto.randomUUID(),
          label: normalizeText(label),
          value: normalizeText(value),
        };
      }
      return null;
    })
    .filter(Boolean);

  return {
    id,
    name,
    url,
    categories,
    ingredients,
    steps,
    notes: normalizeText(raw.notes),
    source: raw.source || null,
    nutrition,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function combineIngredientTotals(ingredients) {
  const totals = new Map();
  for (const entry of ingredients) {
    const ing = normalizeIngredientEntry(entry);
    if (!ing || !ing.ingredient) continue;
    const canonical = canonicalizeIngredientName(ing.ingredient);
    const key = `${ing.unit || "unitless"}::${canonical || ing.ingredient.toLowerCase()}`;
    const current = totals.get(key) || {
      ingredient: ing.ingredient,
      displayName: ing.ingredient,
      unit: ing.unit,
      quantity: 0,
      originalLines: [],
    };
    current.originalLines.push(ing.original);
    current.displayName =
      ing.ingredient.length < current.displayName.length
        ? ing.ingredient
        : current.displayName;
    if (!current.unit && ing.unit) {
      current.unit = ing.unit;
    }
    if (typeof ing.quantity === "number" && !Number.isNaN(ing.quantity)) {
      current.quantity += ing.quantity;
    } else {
      current.quantity = null;
    }
    totals.set(key, current);
  }
  return [...totals.values()].map((item) => ({
    ingredient: item.displayName || item.ingredient,
    unit: item.unit,
    quantity:
      item.quantity === null || Number.isNaN(item.quantity)
        ? null
        : Math.round(item.quantity * 100) / 100,
    notes:
      item.originalLines.length > 1
        ? `Merged from: ${item.originalLines.join("; ")}`
        : item.originalLines[0] || "",
  }));
}

function calculateShoppingList(recipes) {
  const allIngredients = [];
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients || []) {
      allIngredients.push(ingredient);
    }
  }
  return combineIngredientTotals(allIngredients);
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    respondText(res, 200, "", DEFAULT_HEADERS);
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith("/api")) {
      if (req.method !== "GET") {
        respondJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const served = await serveStatic(pathname, res);
      if (!served) {
        respondJson(res, 404, { error: "Not found" });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/session") {
      const body = await getRequestBody(req);
      if (!body || typeof body.password !== "string") {
        respondJson(res, 400, { error: "Password is required" });
        return;
      }
      const password = body.password.trim();
      if (!password) {
        respondJson(res, 400, { error: "Password cannot be empty" });
        return;
      }
      const token = hashPassword(password);
      const data = await loadData();
      let user = ensureUser(data, token, {
        createIfMissing: Boolean(body.createIfMissing),
      });
      if (!user) {
        respondJson(res, 404, {
          error: "No list exists for that password",
          token,
        });
        return;
      }
      if (body.createIfMissing && user.createdAt) {
        await saveData(data);
      }
      respondJson(res, 200, {
        token,
        recipes: user.recipes,
        createdAt: user.createdAt,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/parse-recipe") {
      const body = await getRequestBody(req);
      if (
        !body ||
        (typeof body.url !== "string" && typeof body.text !== "string")
      ) {
        respondJson(res, 400, {
          error: "Provide a recipe URL or plain text to parse",
        });
        return;
      }

      const hasText =
        typeof body.text === "string" && body.text.trim().length > 0;
      const hasUrl =
        typeof body.url === "string" && body.url.trim().length > 0;

      if (!hasText && !hasUrl) {
        respondJson(res, 400, {
          error: "Provide a non-empty recipe URL or text blob",
        });
        return;
      }

      if (hasText && !hasUrl) {
        const parsed = parsePlainTextRecipe(body.text);
        const structuredIngredients = parsed.ingredients.map((line) => ({
          id: crypto.randomUUID(),
          ...tokenizeIngredient(line),
        }));
        const structuredNutrition = attachNutritionIds(parsed.nutrition || []);
        respondJson(res, 200, {
          ...parsed,
          url: null,
          ingredients: structuredIngredients,
          nutrition: structuredNutrition,
        });
        return;
      }

      const recipeUrl = body.url.trim();
      try {
        new URL(recipeUrl);
      } catch {
        respondJson(res, 400, { error: "Invalid recipe URL" });
        return;
      }
      const parsed = await scrapeRecipe(recipeUrl);
      const structuredIngredients = parsed.ingredients.map((line) => ({
        id: crypto.randomUUID(),
        ...tokenizeIngredient(line),
      }));
      const structuredNutrition = attachNutritionIds(parsed.nutrition || []);
      respondJson(res, 200, {
        ...parsed,
        url: recipeUrl,
        ingredients: structuredIngredients,
        nutrition: structuredNutrition,
      });
      return;
    }

    if (
      (req.method === "GET" && pathname === "/api/recipes") ||
      req.method === "POST" ||
      req.method === "PUT" ||
      req.method === "DELETE"
    ) {
      const data = await loadData();
      const auth = requireUser(req, res, data);
      if (!auth) return;
      const { token, user } = auth;

      if (req.method === "GET" && pathname === "/api/recipes") {
        respondJson(res, 200, { recipes: user.recipes || [] });
        return;
      }

      if (req.method === "POST" && pathname === "/api/recipes") {
        const body = await getRequestBody(req);
        try {
          const recipe = buildRecipePayload(body);
          recipe.url = body.url || recipe.url;
          recipe.categories = normalizeCategories(body.categories);
          recipe.ingredients =
            recipe.ingredients && recipe.ingredients.length
              ? recipe.ingredients
              : [];
          user.recipes = user.recipes || [];
          user.recipes.push(recipe);
          await saveData(data);
          respondJson(res, 201, { recipe });
        } catch (error) {
          respondJson(res, 400, { error: error.message });
        }
        return;
      }

      if (req.method === "PUT" && pathname.startsWith("/api/recipes/")) {
        const recipeId = pathname.split("/").pop();
        const body = await getRequestBody(req);
        const existingIndex = (user.recipes || []).findIndex(
          (item) => item.id === recipeId
        );
        if (existingIndex === -1) {
          respondJson(res, 404, { error: "Recipe not found" });
          return;
        }
        try {
          const updated = buildRecipePayload({ ...user.recipes[existingIndex], ...body, id: recipeId });
          user.recipes[existingIndex] = updated;
          await saveData(data);
          respondJson(res, 200, { recipe: updated });
        } catch (error) {
          respondJson(res, 400, { error: error.message });
        }
        return;
      }

      if (req.method === "DELETE" && pathname.startsWith("/api/recipes/")) {
        const recipeId = pathname.split("/").pop();
        const beforeLength = (user.recipes || []).length;
        user.recipes = (user.recipes || []).filter(
          (recipe) => recipe.id !== recipeId
        );
        if (user.recipes.length === beforeLength) {
          respondJson(res, 404, { error: "Recipe not found" });
          return;
        }
        await saveData(data);
        respondJson(res, 204, {});
        return;
      }
    }

    if (req.method === "POST" && pathname === "/api/shopping-list/preview") {
      const body = await getRequestBody(req);
      if (!body) {
        respondJson(res, 400, { error: "Request body is required" });
        return;
      }

      if (Array.isArray(body.recipeIds) && body.recipeIds.length > 0) {
        const data = await loadData();
        const auth = requireUser(req, res, data);
        if (!auth) return;
        const { user } = auth;
        const selected = (user.recipes || []).filter((recipe) =>
          body.recipeIds.includes(recipe.id)
        );
        const preview = calculateShoppingList(selected);
        respondJson(res, 200, { shoppingList: preview });
        return;
      }

      if (Array.isArray(body.recipes) && body.recipes.length > 0) {
        const preview = calculateShoppingList(body.recipes);
        respondJson(res, 200, { shoppingList: preview });
        return;
      }

      respondJson(res, 400, {
        error: "Provide recipeIds with authentication or inline recipes array",
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/shopping-list/export") {
      const body = await getRequestBody(req);
      if (!body || !Array.isArray(body.items)) {
        respondJson(res, 400, { error: "Items array is required" });
        return;
      }
      await mkdir(EXPORT_DIR, { recursive: true });
      const filename = `shopping-list-${Date.now()}.json`;
      const filePath = path.join(EXPORT_DIR, filename);
      await writeFile(filePath, JSON.stringify(body, null, 2));
      respondJson(res, 200, { message: "Export saved", filename });
      return;
    }

    respondJson(res, 404, { error: "Not found" });
  } catch (err) {
    respondJson(res, 500, { error: err.message || "Internal server error" });
  }
}

async function serveStatic(requestPath, res) {
  try {
    await access(CLIENT_DIR);
  } catch {
    return false;
  }
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  let filePath = path.join(CLIENT_DIR, safePath);
  if (!filePath.startsWith(CLIENT_DIR)) {
    return false;
  }
  try {
    const content = await readFile(filePath);
    const contentType = getContentType(filePath);
    respondBuffer(res, 200, content, { "Content-Type": contentType });
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".jsx":
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

const PORT = process.env.PORT || 4000;

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Family Meal Planner API listening on port ${PORT}`);
});
