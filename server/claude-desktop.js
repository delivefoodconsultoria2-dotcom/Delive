// Liga o TrafgFood ao app do Claude para Windows/Mac (que usa a assinatura da pessoa),
// registrando "TrafgFood.exe --mcp" no claude_desktop_config.json.
import fs from "node:fs";
import path from "node:path";

function pastasClaude() {
  const out = [];
  const A = process.env.APPDATA, L = process.env.LOCALAPPDATA, H = process.env.HOME || process.env.USERPROFILE || "";
  if (A) out.push(path.join(A, "Claude"));
  // Versão da Microsoft Store guarda em outra pasta.
  if (L) {
    try {
      for (const d of fs.readdirSync(path.join(L, "Packages"))) if (/^(Anthropic\.)?Claude/i.test(d)) out.push(path.join(L, "Packages", d, "LocalCache", "Roaming", "Claude"));
    } catch (_) {}
  }
  if (process.platform === "darwin") out.push(path.join(H, "Library", "Application Support", "Claude"));
  return out;
}

export function statusClaudeDesktop() {
  const pastas = pastasClaude().filter((p) => fs.existsSync(p));
  const ligado = pastas.some((p) => {
    try { return Boolean(JSON.parse(fs.readFileSync(path.join(p, "claude_desktop_config.json"), "utf8")).mcpServers?.trafgfood); } catch { return false; }
  });
  return { instalado: pastas.length > 0, ligado };
}

export function conectarClaudeDesktop() {
  if (!process.env.TF_ROOT) throw new Error("Isso só funciona no TrafgFood instalado no computador.");
  let pastas = pastasClaude().filter((p) => fs.existsSync(p));
  if (!pastas.length) throw new Error("Não achei o app do Claude neste computador. Instale em claude.ai/download, entre com a sua conta e tente de novo.");
  for (const p of pastas) {
    const f = path.join(p, "claude_desktop_config.json");
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) {}
    if (fs.existsSync(f)) fs.copyFileSync(f, f + ".antes-do-trafgfood");
    cfg.mcpServers = { ...(cfg.mcpServers || {}), trafgfood: { command: process.execPath, args: ["--mcp"] } };
    fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  }
  return "Pronto. Feche o app do Claude por completo (também no ícone perto do relógio) e abra de novo.";
}
