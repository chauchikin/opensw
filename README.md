# opensw

照 Scientific Word 5.5 重做的開源數學編輯器。

還有不少人在用 5.5 寫數學文件，可是它在現在的電腦上越來越難跑。
opensw 想做的事很簡單：5.5 的檔案打得開、改得動、排得出來，用法跟 5.5 一樣。

English: [README.en.md](README.en.md)

## 能做什麼

- 打開 Scientific Word 5.x 的 `.tex` 和 6.x 的 `.sci`
- 存成 `.sci`，也可以存回 5.x 格式的 `.tex` 給 5.5 用（中文用 Big5）
- 文字和公式混著打，選單和快捷鍵照 5.5
- 計算選單用 SymPy：化簡、解方程、微積分、矩陣、常微分方程、統計
- 表格、圖片、註腳、引用文獻、索引、交叉引用、有編號的公式
- 5.5 的繪圖會照檔案裡的設定重新畫出來
- 排成 PDF（XeLaTeX，可以排中文），也能匯出 LaTeX、HTML、Markdown
- 桌面版有 MCP，AI 可以直接讀、改、算、排版

5.x 的指令遇到不認得的，會原樣留成 TeX 欄位，存檔和匯出都不會掉。

## 怎麼跑

```
npm install
npx vite              # 開發用（瀏覽器打開 http://localhost:5173）
npx vite build        # 網頁版輸出到 dist/
npx tauri build       # 桌面版（要先裝 Rust）
```

測試在 `test/`，用 Playwright 的 Chromium 跑，例如：

```
npx vite preview --port 4173 &
node test/tables.mjs
```

## 授權

MIT，見 [LICENSE](LICENSE)。

用到的元件有各自的授權：ProseMirror、MathLive、CortexJS Compute Engine（MIT）、SymPy、mpmath（BSD）、Pyodide（MPL-2.0）、Tauri（MIT／Apache-2.0）、Tectonic（MIT）。

## 致謝

Scientific Word 是 MacKichan Software 做的。這麼多年來它讓很多人可以好好寫數學，opensw 的選單、快捷鍵和檔案格式都是照它來的，謝謝他們。

opensw 的程式是重新寫的，沒有用 Scientific Word 的程式碼、圖示或範例檔。
排 5.x 文件時會用到 5.x 的巨集檔（tcilatex 等）。附在 opensw 裡的只有檔案裡寫明可以自由複製和散布的那些，沒寫的都換成 opensw 自己寫的版本。電腦有裝 5.x 的話，會先用你自己那份。

opensw 跟 MacKichan Software 沒有關係，也不是他們的產品。Scientific Word 是 MacKichan Software 的商標。
