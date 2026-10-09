// Fotos dos anúncios: ficam guardadas no computador (DATA_DIR/imagens) até a campanha ser criada.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DIR = path.join(process.env.DATA_DIR || path.resolve("data"), "imagens");
const TIPOS = { "image/jpeg": "jpg", "image/png": "png" };

export function salvarImagem(dataUrl, nome) {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new Error("Use uma foto JPG ou PNG.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("A foto passa de 8 MB. Use uma menor.");
  const id = crypto.randomBytes(8).toString("hex") + "." + TIPOS[m[1]];
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, id), buf);
  return { id, nome: String(nome || id).slice(0, 80), url: "/api/imagens/" + id };
}

export function caminhoImagem(id) {
  if (!/^[a-f0-9]{16}\.(jpg|png)$/.test(String(id))) throw new Error("Foto não encontrada.");
  const p = path.join(DIR, id);
  if (!fs.existsSync(p)) throw new Error("Foto não encontrada. Escolha a foto de novo.");
  return p;
}

export function lerImagem(id) {
  return { base64: fs.readFileSync(caminhoImagem(id)).toString("base64"), nome: id };
}
