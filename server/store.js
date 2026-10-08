// Armazenamento simples em arquivo JSON. Suficiente para uma consultoria com
// dezenas de lojas; trocar por Postgres quando houver vários usuários ao mesmo tempo.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const FILE = path.join(DATA_DIR, "db.json");

const EMPTY = { clients: [], actions: [], audit: [], mockCampaigns: null };

let db = null;

function load() {
  if (db) return db;
  try {
    db = { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    db = structuredClone(EMPTY);
  }
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

export const store = {
  get() {
    return load();
  },
  update(fn) {
    load();
    const out = fn(db);
    save();
    return out;
  },
  id(prefix) {
    return prefix + "_" + crypto.randomBytes(6).toString("hex");
  },
  // Registro de auditoria: toda alteração (pessoa ou copiloto) fica guardada.
  audit(entry) {
    return this.update((d) => {
      d.audit.push({ at: new Date().toISOString(), ...entry });
      if (d.audit.length > 2000) d.audit = d.audit.slice(-2000);
    });
  },
};
