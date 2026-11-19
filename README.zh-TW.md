# opensw

[English](README.md) | **繁體中文**

照 Scientific Word 5.5 重做的開源數學編輯器。

還有不少人在用 5.5 寫數學文件，可是它在現在的電腦上越來越難跑。
opensw 想做的事很簡單：5.5 的檔案打得開、改得動、排得出來，用法跟 5.5 一樣。

## 能做什麼

- 打開 Scientific Word 5.x 的 `.tex` 和 6.x 的 `.sci`
- 以 5.x 的 `.tex` 為主：存回原檔（先留 `.bak`，中文用 Big5），只重寫改過的段落、其他照原檔一字不動，排版也用這份；也可以另存成 `.sci`
- 文字和公式混著打，選單和快捷鍵照 5.5
- 計算選單用 SymPy：化簡、解方程、微積分、矩陣、常微分方程、統計；電腦有裝 Mathematica 的話，可以在 工具 > 計算引擎 改用 Mathematica（桌面版）。要接其他計算引擎：[ENGINE.md](ENGINE.md)。計算是 opensw 自己的功能（5.5 用 MuPAD），答案寫法不一定和 5.5 一樣
- 表格、圖片、註腳、引用文獻、索引、交叉引用、有編號的公式
- 5.5 的繪圖會照檔案裡的設定重新畫出來（2D、3D 各種繪圖都有）
- 示範題：檔案 > 範例 有三份示範文件（微積分、代數與矩陣、向量統計等），每題寫了用哪個選單指令和答案，可以照著試計算選單
- 考卷產生器：用 5.5 的考卷範本（.qiz）產生多份考卷和答案
- 片段、開啟網址、文件管理（打包成 .zip、開 5.5 的 .rap）
- 排成 PDF（XeLaTeX，可以排中文；Windows 版附 Tectonic 和常用的 TeX 檔，沒有網路也能排），也能匯出 LaTeX、HTML、Markdown
- 介面有英文和繁體中文（工具 > 使用者設定 切換）。程式的原文是英文，中文是翻譯檔 `src/locales/zh-TW.json`；要加其他語言，看 `src/i18n.js` 開頭的說明
- 桌面版可以讓 Claude、ChatGPT 控制文件：工具 > 連接 AI 一鍵設定；AI 改過的地方有底色，編輯 > 復原 AI 的修改 一次改回來
- 桌面版有 MCP，AI 可以直接讀、改、算、排版；同樣的指令也能用命令列 `opensw-cli` 下（見 docs/AI.md）

5.x 的指令遇到不認得的，會原樣留成 TeX 欄位，存檔和匯出都不會掉。

每個選單的說明在程式裡：說明 > 完整說明文件（原文在 `src/helpdoc.js`）。

## 下載

Windows 10、11：到 [Releases 頁面](https://github.com/chauchikin/opensw/releases) 下載。

- `opensw_<版本>_x64-setup.exe`：安裝檔，裝在自己的使用者資料夾，不用管理員權限。
- `opensw_<版本>_x64-portable.zip`：免安裝版，要先解開（在檔案上按右鍵，選「解壓縮全部」；直接在壓縮檔裡點 opensw.exe 不能用），再執行資料夾裡的 `opensw.exe`，可以放在隨身碟。

安裝檔沒有數位簽章，第一次執行時 Windows 可能會顯示「Windows 已保護您的電腦」。按「其他資訊」，再按「仍要執行」。

Mac 和 Linux 沒有提供安裝檔，可以照下面「怎麼跑」自己建置。

## 怎麼跑

```
npm install
npx vite              # 開發用（瀏覽器打開 http://localhost:5173）
npx vite build        # 網頁版輸出到 dist/
npx tauri build       # 桌面版（要先裝 Rust）
```

測試在 `test/`，用 Playwright 的 Chromium 跑。先建置、開預覽，再跑全部或其中幾個：

```
npx vite build
npx vite preview --port 4173 &
npm test              # 全部
npm test tables       # 只跑 test/tables.mjs
```

## 授權

MIT，見 [LICENSE](LICENSE)。

用到的元件有各自的授權：ProseMirror、MathLive、CortexJS Compute Engine（MIT）、SymPy、mpmath（BSD）、Pyodide（MPL-2.0）、Tauri（MIT／Apache-2.0）、Tectonic（MIT）。授權全文在 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)，安裝檔裡也有一份。換了套件後用 `node scripts/licenses.mjs` 重新產生。

## 致謝

Scientific Word 是 MacKichan Software 做的。這麼多年來它讓很多人可以好好寫數學，opensw 的選單、快捷鍵和檔案格式都是照它來的，謝謝他們。

opensw 的程式是重新寫的，沒有用 Scientific Word 的程式碼、圖示或範例檔。
排 5.x 文件時會用到 5.x 的巨集檔（tcilatex 等）。附在 opensw 裡的只有檔案裡寫明可以自由複製和散布的那些，沒寫的都換成 opensw 自己寫的版本。電腦有裝 5.x 的話，會先用你自己那份。

opensw 跟 MacKichan Software 沒有關係，也不是他們的產品。Scientific Word 是 MacKichan Software 的商標。
