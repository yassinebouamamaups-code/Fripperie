import fs from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";
import { httpError } from "./http.mjs";

const DEFAULT_HEADERS = [
  "id",
  "categorie",
  "nom",
  "taille",
  "prix",
  "promo",
  "selection_moment",
  "description",
  "photos",
  "statut"
];

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function getAdminCatalogState() {
  const writeFile = config.catalogWriteFile;

  return {
    sourceUrl: getPublicCatalogCsvUrl(),
    writeFile,
    writable: Boolean(writeFile),
    items: writeFile ? listWritableCatalogItems() : [],
    publicImageBaseUrl: `${config.appBaseUrl}`,
    adminEnabled: Boolean(config.adminPassword)
  };
}

export function listWritableCatalogItems() {
  const { headers, rows } = readWritableCatalogTable();

  return rows
    .map((row) => mapRowToItem(headers, row))
    .filter(hasVisibleCatalogData)
    .reverse();
}

export function appendCatalogItem(input) {
  const { headers, rows } = readWritableCatalogTable();
  const item = normalizeCatalogInput(input);
  const idIndex = ensureHeader(headers, "id");
  const photoIndex = ensureHeader(headers, "photos");

  const row = headers.map((header) => item[header] ?? "");
  if (!row[idIndex]) {
    row[idIndex] = buildCatalogId(item.nom || item.categorie || "article");
  }

  while (row.length < headers.length) row.push("");

  if (!clean(row[photoIndex])) {
    row[photoIndex] = "";
  }

  rows.push(row);
  writeWritableCatalogTable(headers, rows);

  return mapRowToItem(headers, row);
}

export function saveCatalogImage({ fileName, contentType, buffer }) {
  if (!config.catalogWriteFile) {
    throw httpError(400, "CATALOG_WRITE_FILE non configure.");
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw httpError(400, "Image vide.");
  }

  const extension = resolveImageExtension(fileName, contentType);
  if (!extension) {
    throw httpError(400, "Format d'image non pris en charge.");
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const baseName = sanitizeFileName(path.parse(fileName || "photo").name) || "photo";
  const uniqueName = `${stamp}-${Math.random().toString(36).slice(2, 8)}-${baseName}${extension}`;
  const absolutePath = path.join(config.catalogUploadsDir, uniqueName);

  fs.writeFileSync(absolutePath, buffer);

  return {
    fileName: uniqueName,
    relativeUrl: `${config.appBaseUrl}/media/catalog/${uniqueName}`,
    publicUrl: `${config.appBaseUrl}/media/catalog/${uniqueName}`
  };
}

export function readCatalogCsvText() {
  if (config.catalogWriteFile) {
    const { headers, rows } = readWritableCatalogTable();
    return stringifyCsv([headers, ...rows]);
  }

  if (!config.catalogSourceUrl) {
    return `${DEFAULT_HEADERS.join(",")}\r\n`;
  }

  return "";
}

export function getCatalogUploadAsset(fileName) {
  const safeName = path.basename(clean(fileName));
  if (!safeName) {
    throw httpError(404, "Image introuvable.");
  }

  const absolutePath = path.join(config.catalogUploadsDir, safeName);
  if (!fs.existsSync(absolutePath)) {
    throw httpError(404, "Image introuvable.");
  }

  return {
    absolutePath,
    fileName: safeName,
    buffer: fs.readFileSync(absolutePath),
    contentType: contentTypeFromExtension(path.extname(safeName))
  };
}

export function requireAdminAccess(request) {
  const expected = clean(config.adminPassword);
  if (!expected) {
    throw httpError(503, "ADMIN_PASSWORD non configure.");
  }

  const provided = clean(request?.headers?.["x-admin-key"]);
  if (!provided || provided !== expected) {
    throw httpError(401, "Acces admin refuse.");
  }
}

export function getPublicCatalogCsvUrl() {
  return `${config.appBaseUrl}/api/catalog/source.csv`;
}

function readWritableCatalogTable() {
  if (!config.catalogWriteFile) {
    throw httpError(400, "CATALOG_WRITE_FILE non configure.");
  }

  const targetFile = config.catalogWriteFile;

  if (!fs.existsSync(targetFile)) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, `${DEFAULT_HEADERS.join(",")}\r\n`, "utf8");
  }

  const source = fs.readFileSync(targetFile, "utf8");
  const table = parseCsv(source);

  if (!table.length) {
    return { headers: [...DEFAULT_HEADERS], rows: [] };
  }

  const headers = table[0].map((header) => clean(header));
  DEFAULT_HEADERS.forEach((header) => {
    ensureHeader(headers, header);
  });

  return {
    headers,
    rows: table.slice(1).map((row) => {
      const normalizedRow = Array.isArray(row) ? [...row] : [];
      while (normalizedRow.length < headers.length) normalizedRow.push("");
      return normalizedRow.slice(0, headers.length);
    })
  };
}

function writeWritableCatalogTable(headers, rows) {
  const targetFile = config.catalogWriteFile;
  const csvRows = [headers, ...rows];
  fs.writeFileSync(targetFile, stringifyCsv(csvRows), "utf8");
}

function normalizeCatalogInput(input) {
  const item = {
    id: clean(input?.id),
    categorie: clean(input?.categorie),
    nom: clean(input?.nom),
    taille: clean(input?.taille),
    prix: clean(input?.prix),
    promo: clean(input?.promo),
    selection_moment: isTruthy(input?.selection_moment) ? "oui" : "",
    description: clean(input?.description),
    photos: normalizePhotos(input?.photos),
    statut: normalizeStatus(input?.statut)
  };

  if (!item.categorie) {
    throw httpError(400, "Categorie obligatoire.");
  }

  if (!item.nom) {
    throw httpError(400, "Nom obligatoire.");
  }

  if (!item.prix) {
    throw httpError(400, "Prix obligatoire.");
  }

  return item;
}

function normalizePhotos(value) {
  const photos = Array.isArray(value)
    ? value
    : String(value || "").split(/[|;\n]/);

  return photos
    .map((entry) => clean(entry))
    .filter(Boolean)
    .join(" | ");
}

function normalizeStatus(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "indisponible") return "indisponible";
  return "disponible";
}

function mapRowToItem(headers, row) {
  const item = {};
  headers.forEach((header, index) => {
    item[header] = clean(row[index] || "");
  });
  return item;
}

function hasVisibleCatalogData(item) {
  return Boolean(
    item.id
    || item.categorie
    || item.nom
    || item.prix
    || item.promo
    || item.description
    || item.photos
    || item.statut
  );
}

function ensureHeader(headers, headerName) {
  const normalized = clean(headerName).toLowerCase();
  const index = headers.findIndex((header) => clean(header).toLowerCase() === normalized);
  if (index >= 0) return index;
  headers.push(headerName);
  return headers.length - 1;
}

function buildCatalogId(label) {
  const base = clean(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "article";

  return `${base}-${Date.now().toString(36)}`;
}

function resolveImageExtension(fileName, contentType) {
  const byName = clean(path.extname(fileName)).toLowerCase();
  if (ALLOWED_IMAGE_EXTENSIONS.has(byName)) {
    return byName;
  }

  const normalizedType = clean(contentType).toLowerCase();
  if (normalizedType === "image/jpeg") return ".jpg";
  if (normalizedType === "image/png") return ".png";
  if (normalizedType === "image/webp") return ".webp";
  if (normalizedType === "image/gif") return ".gif";
  return "";
}

function contentTypeFromExtension(extension) {
  const normalized = clean(extension).toLowerCase();
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".png") return "image/png";
  if (normalized === ".webp") return "image/webp";
  if (normalized === ".gif") return "image/gif";
  return "application/octet-stream";
}

function sanitizeFileName(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (current === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (current === '"') {
      quoted = !quoted;
      continue;
    }

    if (current === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((current === "\n" || current === "\r") && !quoted) {
      if (current === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += current;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

function stringifyCsv(rows) {
  return rows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function isTruthy(value) {
  return ["oui", "yes", "true", "1", "x", "on"].includes(clean(value).toLowerCase());
}

function clean(value) {
  return String(value || "").trim();
}
