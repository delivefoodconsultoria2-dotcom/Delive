// Pasta raiz do app. No TrafgFood.exe ela vem de TF_ROOT (a pasta do .exe).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = process.env.TF_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
