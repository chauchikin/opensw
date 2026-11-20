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

AI 能開檔的地方：專案資料夾（sw_info 的 aiFolder，預設是桌面的 `opensw projects`）、目前文件的資料夾、工具 > 使用者設定 裡允許 AI 用的資料夾（含裡面的子資料夾），和舊版讓 AI 存檔的 文件\opensw。其他地方 opensw 會跳出視窗問使用者，按「確定」只允許那一次。
AI 能存檔的地方只有專案資料夾（新文件給一個專案資料夾裡的 path 就能存），而且只能存成 .tex 或 .sci。專案資料夾外面一律不寫，也不會問使用者。

## 桌面版：開檔就是匯入，三份紀錄
規則在 src/projects.js（不碰磁碟，測試用記憶體裡的檔案跑：test/projects.mjs、test/import.mjs、test/import_rules.mjs、test/records.mjs）。
- 有 `opensw records\project.json` 而且讀得出來的資料夾才是專案。只有專案裡的檔案會就地打開；其他檔案（包括專案資料夾裡沒有紀錄的子資料夾、專案的 `opensw records` 裡面的檔）一律匯入：opensw 把它和它用到的檔案（圖片、子文件和子文件用到的圖片、.bib、`\lstinputlisting` 這類指到的檔）複製到 `專案資料夾\<檔名>_<匯入日期>\`，開的是複本。回覆的 path 是複本，`imported: { from, folder, copied, notFound, notCopied }` 說明複製了什麼（用絕對路徑或 `..` 指到的檔不複製，列在 notCopied）。
- 同一個檔案以前匯入過（路徑比對不分大小寫、斜線、`.`、結尾的點和空白、`\\?\` 開頭）：開的是那份複本（`project.json` 的 main，另存或改名後會跟著改），回覆的 `alreadyImported.originalChanged` 和 note 說原檔之後有沒有改過；要重新匯入成新的複本加 `fresh: true`（資料夾名後面加 `_2`、`_3`）。編輯器裡已經開著的專案檔不會再讀一次，直接換到畫面上（回覆有 `alreadyOpen: true`，還沒存的修改都在）。
- 路徑比不出來的同一個檔（網路磁碟機和它的 `\\server` 名稱、8.3 短檔名）：沒有同路徑的匯入、但有檔名相同而且內容（SHA-256）相同的，使用者會被問（照實說「匯入過一個檔名相同、內容相同的檔案」）；AI 沒辦法問，所以照它給的路徑匯入成新複本，回覆的 `alike: { importedFrom, on, copy }` 和 note 告訴它那一份。
- 匯入失敗（磁碟滿、沒權限）：回錯誤，什麼都不開，建到一半的資料夾丟進資源回收筒。（使用者自己開檔時會被問要不要直接開原檔；這樣開的文件沒有專案、沒有紀錄，sw_records 和 sw_handoff 會照實說。）
- AI 只能存在專案資料夾裡：sw_save 寫不到專案資料夾外面的任何地方，不管那裡有沒有檔、資料夾有沒有允許（允許的資料夾只管開檔）。所以原檔不管用哪個名字連過去都寫不到；沒匯入就地打開的檔（在專案資料夾外面）AI 也不能存，要給專案資料夾裡的 path。「在不在專案資料夾裡」是問磁碟的，不是看路徑的字：專案資料夾裡有捷徑（junction）連到外面，算外面。要放一份複本到外面，由使用者用 檔案 > 另存新檔。另外 path 如果是任何一個專案的 `source`（匯入時的原檔）或在專案的 `opensw records` 裡面，會照那個原因拒絕。使用者自己在 檔案 > 另存新檔 選原檔是可以的，訊息、修改紀錄和檔案地圖都會寫明原檔被蓋過。
- sw_save 不給 path：存回專案資料夾裡的複本。path 在文件自己的專案資料夾裡：那個檔變成開著的文件（主文件另存成別的檔名時，`project.json` 的 main 跟著改）。path 在專案資料夾的其他地方：文件得到自己的新資料夾 `<檔名>_<日期>`（還沒存過的新文件要給這樣的 path）。path 在專案資料夾外面：拒絕，什麼都不寫。
- 文件開著的時候記得自己的專案（資料夾和 `project.json` 的內容），不會每次存檔重新用設定和路徑去算：使用者設定裡改了專案資料夾，只影響之後的匯入和新文件。存檔時專案資料夾不見了（改名、搬走、刪掉）：使用者會被問要不要在原處重建，AI 得到錯誤。
- 不是 5.x 寫的 LaTeX 檔（from55 是 false）：專案的主文件，sw_save 直接把複本寫成 5.x 檔，匯入時的 LaTeX 原樣留在 `opensw records\Original`；其他（跟著匯入的子文件、沒匯入就地打開的檔）沒有另一份，所以要給新的 path。
- 每個專案資料夾有 `opensw records`，裡面三份白話英文紀錄（給教授看的，不是機器格式）：
  - `Change log.txt`：opensw 自己寫，不交給 AI。匯入、AI 每個改到文件的指令、每次存檔（誰存的、複本存到哪）、使用者按 編輯 > 復原 AI 的修改、AI 改過之後沒存檔就關掉，各一筆。AI 的修改只列真的不一樣的區塊（區塊從 1 算，最多列 8 個），每個區塊有改之前和改之後的文字（各取 400 字，從差異附近開始）；標題最後的 `[command: …]` 是指令名稱。AI 程式在 MCP 連線時報的名字會寫進去，沒有就寫 AI。只改前言（preamble）的 sw_set 也會記一筆。寫不進去的那一筆會留著，下一筆時一起寫。
  - `File map.txt`：匯入和每次存檔時重寫，講的一直是專案的主文件（存子文件也一樣）。資料夾、主文件、從哪裡匯入、用到的檔案、找不到的檔案、備份、紀錄各是什麼、步驟檔、PDF 排到哪裡。
  - `Handoff notes.txt`：AI 用 sw_handoff 寫（想做什麼、做了什麼、還剩什麼），opensw 加上日期時間，內文每行縮排兩格。
  - 另外有 `project.json`（給程式看的同一份資料；只有不存在時才新建，讀不出來時不動它）和 `Original\`（匯入時的原檔；opensw 不會開它、不會寫它）。
- sw_records：回 `{ folder, files, changeLog（最後幾筆，整筆整筆給，大約 60 行）, fileMap, handoff（最後 3 則） }`。開始改之前先讀；做完之前用 sw_handoff 留一則。sw_open 和 sw_info 的回覆也帶 `project: { folder, importedFrom, records }` 和最新一則 handoff。
- 還沒有專案資料夾的文件（新的、還沒存）：修改紀錄和交接筆記先放在記憶體，第一次存檔時寫進去。

## 桌面版：命令列 opensw-cli
裝不了 AI 程式的電腦（或寫腳本時）用 `opensw-cli.exe`，在 opensw.exe 旁邊。指令和 MCP 工具一樣（不用加 sw_），
一樣傳給正在開的編輯器，沒開會自動打開；能開、能存的地方也一樣（見上面）。
```
opensw-cli help                 列出指令
opensw-cli help save            一個指令的參數
opensw-cli open --path D:\Papers\a.tex
opensw-cli replace --find 舊字 --with 新字
opensw-cli save
opensw-cli compute --latex "\int_0^1 x^2 dx"
opensw-cli compute --json "{\"latex\":\"x^2-1=0\",\"op\":\"solve\"}"
opensw-cli compute --json-file a.json     參數寫在檔案裡（UTF-8 的 JSON），不用處理引號和反斜線
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
- 同時開好幾份文件：sw_documents 列出來（doc 0 是畫面上那一份，其他指令都作用在它身上），sw_switchTo 換另一份到畫面上，sw_close 關掉一份。有修改還沒存的不會關：先 sw_save，或加 `discard: true`（opensw 會跳出視窗問使用者，4 分鐘沒回就當不同意）。
- sw_open 開檔時，畫面上那份如果有還沒存的修改，會留在視窗選單裡，不會不見；沒有修改的就換成新開的檔。
- sw_engine：看計算選單用的引擎（engine）、可以選的引擎（available）和版本（versions）；給 `engine`（available 裡的 id，例如 `sympy`、`mathematica`）就改選它，和 工具 > 計算引擎 一樣。程式的位置只能在對話框裡設定。

## 推導步驟（逐行檢查）
把一份推導的每一條獨立公式當成一步，記下它用到哪幾步，交給計算引擎逐步檢查。
- 名字、用到哪幾步、上次檢查的結果都放在文件旁邊的 `<文件名>.steps.json`，文件本身不改。公式有 `\label` 的，名字就是那個 label。
- sw_nameSteps：替還沒有名字的獨立公式取名（s1、s2 …）。加 `inDocument: true` 才會把名字寫進文件（`\label`，5.5 顯示成標記）。
- sw_setStep：設定一步用到哪幾步（uses）、白話說明（note）、不檢查直接相信的理由（trust）、公式沒寫出來的推理（extra：`{ latex, equals, why, op?, params? }`）。
- sw_setGiven：題目給的定義（例如 `a=2`、`f(x)=x^2`），取一個名字讓各步用。
- sw_checkSteps：檢查全部或指定幾步。每個等式問的是「左邊減右邊化簡後是不是 0」，只帶入這一步用到的定義；`= … + O(x^n)` 改問「相減之後在 0 的前 n−1 階微分都是 0」。
- sw_steps：總表。每步的狀態：pass（通過）、fail（不相等，附反例）、unknown（不能判定，例如少了某個名字的定義）、unchecked（沒檢查過，或檢查之後公式或它用到的步改過）、trusted（直接相信）；ready 是現在可以做的步。加 name 看一步的全部細節。
- 公式搬位置、前後插入別的公式，名字跟著公式走（比對公式文字；5.5 存檔把 `'` 寫成 `^{\prime }` 不算改）。公式改寫過的，照它的位置認回來，並在 problems 裡說明；認不出來就列為 lost，用 sw_setStep 的 block 重新指定。
- 多列的公式（eqnarray、align）整個算一步：一列一句，開頭是 `=` 的列接著上一列。寫進文件的名字放在第一列。
- 文件另存成別的檔名（或第一次存檔）時，`.steps.json` 會跟著複製到新檔名旁邊；新檔名旁邊已經有的不蓋掉。
- 「相等」是計算引擎化簡的結果，不是形式證明。
