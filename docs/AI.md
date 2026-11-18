# 讓 AI 控制 opensw

## 桌面版：MCP
`opensw.exe --mcp` 是一個 MCP 伺服器（stdin/stdout）。AI 程式呼叫工具時，它把指令傳給
正在開的編輯器；編輯器沒開會自動打開。工具名稱都是 `sw_` 開頭（sw_outline、sw_set …），
清單在 `src-tauri/mcp-tools.json`（由 `node scripts/gen-mcp-tools.mjs` 從 src/api.js 產生）。

Claude 桌面版（claude_desktop_config.json）：
```json
{ "mcpServers": { "opensw": {
    "command": "C:\\Users\\<使用者>\\AppData\\Local\\opensw\\opensw.exe",
    "args": ["--mcp"] } } }
```
Codex（~/.codex/config.toml）：
```toml
[mcp_servers.opensw]
command = 'C:\Users\<使用者>\AppData\Local\opensw\opensw.exe'
args = ["--mcp"]
```

## 網頁版：window.sw
在頁面裡 `await sw.call('outline')`、`await sw.call('insert', { latex: '...', index: 2 })`。
`sw.help()` 列出所有指令。網頁版不能開路徑、存檔、排版（用 get 取 LaTeX）。

## 用法
- 文件是一串區塊（段落、標題、定理、公式…）。先 sw_outline 看編號，再 sw_insert／sw_replaceBlock／sw_deleteBlock。
- 內容一律寫 LaTeX：`\section{..}`、`$..$`、`\[..\]`、`\begin{theorem}..\end{theorem}`、`itemize`/`enumerate`。
- 公式單獨改：sw_formulas 看編號 n，sw_setFormula。
- 從 PDF 重打一份文件：把 PDF 內容寫成 LaTeX，sw_set 一次放進去，再 sw_save 存 .sci、sw_typeset 排版比對。
