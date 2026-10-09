// Entrada do TrafgFood.exe.
//   TrafgFood.exe            abre o TrafgFood (sem janela) e o navegador
//   TrafgFood.exe --mcp      ponte com o app do Claude (protocolo MCP por stdin/stdout)
if (process.argv.includes("--mcp")) require("./mcp.cjs");
else require("./app.cjs");
