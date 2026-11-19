# 讓 AI 控制 opensw

## 最簡單：工具 > 連接 AI
桌面版的 工具 > 連接 AI 會把 opensw 加進 Claude 桌面版（%APPDATA%\Claude 或新版的 %LOCALAPPDATA%\Claude-Data\claude_<id>）、Codex／ChatGPT 桌面版的設定檔（下面兩段的內容，路徑用目前這個 opensw.exe），
其他設定不動，改之前先留一份 `<設定檔>.opensw-backup`。做完把 AI 程式完全關掉再打開。程式在 src-tauri/src/aiconnect.rs。
AI 改過的區塊有底色、狀態列會顯示，編輯 > 復原 AI 的修改 一次改回 AI 開始改之前的樣子（src/aiedits.js）。
說明 > 跟 AI 說話 有給第一次用 AI 的人的例句。

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
Codex 和 ChatGPT 桌面版（兩個共用 ~/.codex/config.toml；只有 ChatGPT 桌面版的 Codex 能用，網頁版和手機版 ChatGPT 連不到電腦上的 opensw）：
```toml
[mcp_servers.opensw]
command = 'C:\Users\<使用者>\AppData\Local\opensw\opensw.exe'
args = ["--mcp"]
```

AI 能開、能存的地方：目前文件的資料夾、文件\opensw（sw_info 的 aiFolder；新文件不用問就能存在這裡），和 工具 > 使用者設定 裡允許 AI 用的資料夾（含裡面的子資料夾）。
其他地方 opensw 會跳出視窗問使用者，按「確定」只允許那一次。AI 只能存成 .tex 或 .sci。

## 桌面版：命令列 opensw-cli
裝不了 AI 程式的電腦（或寫腳本時）用 `opensw-cli.exe`，在 opensw.exe 旁邊。指令和 MCP 工具一樣（不用加 sw_），
一樣傳給正在開的編輯器，沒開會自動打開；能開、能存的地方也一樣（見上面）。
```
opensw-cli help                 列出指令
opensw-cli help save            一個指令的參數
opensw-cli open --path C:\Users\<使用者>\Documents\opensw\a.tex
opensw-cli replace --find 舊字 --with 新字
opensw-cli save
opensw-cli compute --latex "\int_0^1 x^2 dx"
opensw-cli compute --json "{\"latex\":\"x^2-1=0\",\"op\":\"solve\"}"
```
結果印在畫面上（文字照原樣，其他是 JSON），錯誤印在 stderr。結束碼：0 成功，1 指令失敗，2 用法錯。

## 網頁版：window.sw
在頁面裡 `await sw.call('outline')`、`await sw.call('insert', { latex: '...', index: 2 })`。
`sw.help()` 列出所有指令。網頁版不能開路徑、存檔、排版（用 get 取 LaTeX）。

## 用法
- 文件是一串區塊（段落、標題、定理、公式…）。先 sw_outline 看編號，再 sw_insert／sw_replaceBlock／sw_deleteBlock。
- 內容一律寫 LaTeX：`\section{..}`、`$..$`、`\[..\]`、`\begin{theorem}..\end{theorem}`、`itemize`/`enumerate`。
- 公式單獨改：sw_formulas 看編號 n，sw_setFormula。
- 從 PDF 重打一份文件：把 PDF 內容寫成 LaTeX，sw_set 一次放進去，再 sw_save 存 .sci、sw_typeset 排版比對。
