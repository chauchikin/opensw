# 計算引擎接口

English: [ENGINE.en.md](ENGINE.en.md)

opensw 的計算選單、畫圖、考卷產生器都經過同一個接口。想換掉或加上一個計算引擎（Maxima、Giac、自己寫的程式……），照這份文件做，不用改編輯器。

## 怎麼運作

1. 編輯器（`src/compute.js`）把公式的 LaTeX 轉成 MathJSON（CortexJS Compute Engine 的格式）。
2. 依序問引擎：先問 工具 > 計算引擎 選的那個（桌面版，`engine/engines.json` 裡的引擎），再問 SymPy。
3. 引擎不會的指令回 `{"fallback": true}`，就換下一個問。SymPy 是內建的、每個指令都會，所以排最後。

每個引擎只要做一件事：

```
compute(op, 要求) -> 回答
```

`op` 是一個英文小寫字（例如 `factor`），要求和回答都是 JSON 文字。全部指令在下面的表。

## 回答的格式

| kind | 內容 | 例子 |
|---|---|---|
| `value` | `latex`：一個結果 | `{"kind":"value","latex":"(x+1)^2"}` |
| `solutions` | `solutions`：幾個結果（LaTeX）；`label`：接在公式後的文字（可省略） | `{"kind":"solutions","solutions":["x=1","x=2"]}` |
| `boolean` | `value`：true／false | `{"kind":"boolean","value":true}` |
| `text` | `text`：一段文字 | `{"kind":"text","text":" (feasible)"}` |
| `step` | `result`：`equal`、`notequal` 或 `unknown`；`notequal` 時另有 `point`（LaTeX，例如 `x=-\frac{3}{5}`）和 `values`（兩邊在那一點的值） | `{"kind":"step","result":"equal"}` |
| `points`、`grid`、`values`、`ode`、`exam` | 畫圖和考卷用的數字，格式看 `engine/opensw_compute.py` 裡同名指令 | |

另外兩種：

- `{"error": "Cannot compute this yet: <原因>"}`：算不出來。訊息、文字、label 都用英文寫；編輯器用 src/locales/zh-TW.json 換成介面語言（裡面有名稱或數字的訊息用 {0} 寫成一條，例如 "Variables without a value: {0}"）。加了新訊息後，`node scripts/i18n-keys.mjs` 會列出 zh-TW.json 還缺哪些。
- `{"fallback": true}`：這個引擎不做這個指令，交給下一個引擎。

LaTeX 照 Scientific Word 5.5 的樣子寫：矩陣用 `pmatrix`（或 `\left(\begin{matrix}…\end{matrix}\right)`），函數寫成 `f(x)`。

## 定義（計算 > 定義）

定義只記在一個地方：編輯器（`src/compute.js`）。引擎只要會三個指令：

- `define`：記住 `x = 3` 或 `f(x) = x^2`，之後的計算都套用。5.5 的假設也這樣送來：`["assume", "Real"]`（全部變數是實數）、`["assume", "x", "positive"]`、`["additionally", "n", "integer"]`、`["unassume", "x"]`（沒有假設的變數是複數）；`evaluate` `["about", "x"]` 回答目前的假設。不記假設的引擎回 `{"fallback": true}`。
- `define` 也送來解常微分方程 > 數值：`["OdeNumeric", ["List", 方程], ["List", ["List", 名稱, x0, 值, 階], ...]]`，方程（任何階）和每個未知函數的起始值（階 0 是 y(x0)、1 是 y'(x0)……；n 階方程要 0 到 n-1 階的起始值）；未知函數變成數值解的函數（y(1) 是數字），回答 `{"kind": "solutions", "label": ", Functions defined: ", "solutions": ["y"]}`。還有 a_n = .. 在 5.5 的「解讀下標」選了和規則（下標字母出現在右邊就是引數）相反的時候：`{"expr": F, "params": ["'argument'"]}` 或 `["'name'"]`。不做這些的引擎回 `{"fallback": true}`，編輯器之後就把用到這些名稱的計算只交給 SymPy。
- `showdefs`：列出目前的定義。
- `cleardefs`：全部清掉。

工具 > 計算引擎 的兩個設定會寫進公式裡：對數的底設成 10 時，\log x 是 `["Log10", x]`（和 5.5 一樣寫成 \log_{10} x）；基底變數不是 x, y, z 時，∇ 這一類後面接著基底變數：`["Gradient", f, "u", "v", "w"]`。不認得這些的引擎回 fallback。

編輯器會把引擎還沒有的定義先送給它，再問它別的；引擎的程式重新啟動過，編輯器會把定義全部重送一次。所以引擎不用自己存檔或同步。

## 加一個引擎（桌面版）

引擎是電腦上的一個程式（例如 `wolfram.exe`），一直開著，用標準輸入輸出一行一行溝通：

1. 寫一個「轉接檔」放在 `engine/`：讓那個程式讀得懂要求、照上面的格式回答。例子：`engine/opensw_compute.wl`（Mathematica），最短的例子：`engine/opensw_stdio.py`（Python 跑 SymPy）。
2. 在 `engine/engines.json` 加一筆：

| 欄位 | 意思 |
|---|---|
| `id`、`name` | 代號和顯示的名字 |
| `program` | 去哪裡找程式。`*` 代表任何資料夾名稱，找到好幾個時用版本最新的（看路徑裡的數字）；只寫名字（沒有 `/` 或 `\`）就在 PATH 裡找 |
| `example` | 計算引擎對話框裡的路徑例子 |
| `args` | 啟動參數 |
| `adapter` | 轉接檔（`engine/` 裡的檔名） |
| `load` | 啟動後送的第一行：載入轉接檔，並印出 `@@OPENSW@@ready`。留空表示程式從參數載入、自己印這一行 |
| `call` | 每次計算送的一行 |

`args`、`load` 裡的 `{adapter}` 會換成轉接檔的完整路徑，`{adapter64}` 換成同一個路徑的 base64。`call` 裡的 `{op}` 換成指令，`{data}` 換成要求（UTF-8 的 base64）。

程式的回答：輸出裡有 `@@OPENSW@@` 的那一行，後面接回答（UTF-8 的 JSON 的 base64）。其他行（啟動訊息之類）會略過。用 base64 是因為 Windows 主控台的字碼頁會弄壞中文。

3. 驗收：`node scripts/engine-check.mjs <id> [程式路徑]`。它照桌面版的方式啟動引擎，跑 `test/fixtures/engine/cases.json` 的題目並核對答案。題目由 `scripts/engine-cases.mjs` 產生，新增題目改那個檔。

安裝好的 opensw 裡，`engine/` 資料夾在程式資料夾裡；改轉接檔或 `engines.json` 不用重新建置，重開 opensw 就生效。

## 瀏覽器版

瀏覽器版只有 SymPy：`engine/opensw_compute.py` 在 Pyodide 裡跑（`engine/worker.mjs`），不用連網路。

## 全部指令

這張表由 `node scripts/engine-doc.mjs` 從兩個引擎的程式產生（`npm test` 會檢查它是不是最新的）。「要求」欄：F＝公式的 MathJSON；F+p＝`{"expr": F, "params": [...]}`，參數是 MathJSON，或寫成 `'字'` 的一個字；L＝幾條公式排成的一行或矩陣；其他是畫圖和考卷用的 JSON 物件。「交給下一個」表示那個引擎回 `{"fallback": true}`。

<!-- ops -->
| op | 選單 | 要求 | 回答 kind | SymPy | Mathematica |
|---|---|---|---|---|---|
| `evaluate` | 計算 | F | value | ✓ | ✓ |
| `numeric` | 數值計算 | F | value | ✓ | ✓ |
| `simplify` | 化簡 | F | value | ✓ | ✓ |
| `expand` | 展開 | F | value | ✓ | ✓ |
| `factor` | 因式分解 | F | value | ✓ | ✓ |
| `check` | 檢查是否相等 | F | boolean | ✓ | ✓ |
| `solve` | 解 > 精確（F+p：要解的未知數；字 'principal'：只要主值，一個解；一個未知數時只寫值，如 5.5） | F | solutions | ✓ | ✓ |
| `numericsolve` | 解 > 數值（F+p：未知數） | F | solutions | ✓ | ✓ |
| `integersolve` | 解 > 整數 | F | solutions | ✓ | ✓ |
| `recursion` | 解 > 遞迴 | L | solutions | ✓ | ✓ |
| `ode` | 解常微分方程 > 精確 | F | solutions | ✓ | ✓ |
| `rewrite_exp` | 改寫 > 成指數 | F | value | ✓ | ✓ |
| `rewrite_sincos` | 改寫 > 成正弦餘弦 | F | value | ✓ | ✓ |
| `partialfractions` | 多項式 > 部分分式（F+p：變數） | F | value | ✓ | ✓ |
| `collect` | 多項式 > 依變數整理 | F | value | ✓ | ✓ |
| `combine` | 合併 | F | value | ✓ | ✓ |
| `differentiate` | 微積分 > 微分（F+p：變數、次數） | F | value | ✓ | ✓ |
| `integrate` | 微積分 > 不定積分（F+p：變數） | F | value | ✓ | ✓ |
| `byparts` | 微積分 > 分部積分（參數：u） | F+p | value | ✓ | ✓ |
| `changevar` | 微積分 > 換變數（參數：u = g(x)） | F+p | value | ✓ | ✓ |
| `approxint` | 微積分 > 近似積分（參數：'方法'、n） | F+p | value | ✓ | ✓ |
| `iterate` | 微積分 > 迭代（參數：起始值、次數） | F+p | value | ✓ | ✓ |
| `series` | 微積分 > 冪級數（F+p：變數、項數、展開點；項數從最低次數起算，照 5.5） | F | value | ✓ | ✓ |
| `pade` | 微積分 > Padé 近似（F+p：m、n、變數、展開點；沒給是 [2/2]） | F | value | ✓ | ✓ |
| `extrema` | 微積分 > 求極值 | F | solutions | ✓ | ✓ |
| `implicitdiff` | 微積分 > 隱函數微分（F+p：微分變數，沒給是 x） | F | value | ✓ | ✓ |
| `stepcheck` | 推導檢查：a = b 是不是對的一步（參數：b）；答 equal（證明相等）、notequal（附 point、values）或 unknown | F+p | step | ✓ | 交給下一個 |
| `gradient` | 向量微積分 > 梯度（參數：基底變數） | F+p | value | ✓ | ✓ |
| `divergence` | 向量微積分 > 散度 | F+p | value | ✓ | ✓ |
| `curl` | 向量微積分 > 旋度 | F+p | value | ✓ | ✓ |
| `laplacian` | 向量微積分 > 拉普拉斯 | F+p | value | ✓ | ✓ |
| `hessian` | 向量微積分 > 黑塞矩陣 | F+p | value | ✓ | ✓ |
| `jacobian` | 向量微積分 > 雅可比矩陣 | F+p | value | ✓ | ✓ |
| `wronskian` | 向量微積分 > 朗斯基行列式 | F+p | value | ✓ | ✓ |
| `potential` | 向量微積分 > 位勢 | F+p | value | ✓ | ✓ |
| `vectorpotential` | 向量微積分 > 向量位勢 | F+p | value | ✓ | ✓ |
| `determinant` | 矩陣 > 行列式 | F | value | ✓ | ✓ |
| `inverse` | 矩陣 > 反矩陣 | F | value | ✓ | ✓ |
| `transpose` | 矩陣 > 轉置 | F | value | ✓ | ✓ |
| `eigenvalues` | 矩陣 > 特徵值 | F | value | ✓ | ✓ |
| `rank` | 矩陣 > 秩 | F | value | ✓ | ✓ |
| `rref` | 矩陣 > 列簡化（RREF） | F | value | ✓ | ✓ |
| `nullspace` | 矩陣 > 零空間 | F | value | ✓ | ✓ |
| `trace` | 矩陣 > 跡 | F | value | ✓ | ✓ |
| `charpoly` | 矩陣 > 特徵多項式 | F | value | ✓ | ✓ |
| `adjugate` | 矩陣 > 伴隨矩陣 | F | value | ✓ | ✓ |
| `maximize` | 單形法 > 最大化 | L | solutions | ✓ | ✓ |
| `minimize` | 單形法 > 最小化 | L | solutions | ✓ | ✓ |
| `feasible` | 單形法 > 可行性 | L | text | ✓ | ✓ |
| `standardize` | 單形法 > 標準化 | L | solutions | ✓ | ✓ |
| `dual` | 單形法 > 對偶 | L | solutions | ✓ | ✓ |
| `mean` | 統計 > 平均數 | F | value | ✓ | ✓ |
| `median` | 統計 > 中位數 | F | value | ✓ | ✓ |
| `variance` | 統計 > 變異數 | F | value | ✓ | ✓ |
| `stddev` | 統計 > 標準差 | F | value | ✓ | ✓ |
| `laplace` | 轉換 > 拉氏轉換 | F | value | ✓ | ✓ |
| `inverselaplace` | 轉換 > 反拉氏轉換 | F | value | ✓ | ✓ |
| `fourier` | 轉換 > 傅立葉轉換 | F | value | ✓ | ✓ |
| `define` | 定義 > 新定義（x = 3、f(x) = x^2） | F | value | ✓ | ✓ |
| `showdefs` | 定義 > 顯示定義 | F | solutions | ✓ | ✓ |
| `cleardefs` | 定義 > 清除定義 | F | solutions | ✓ | ✓ |
| `version` | 工具 > 計算引擎：顯示版本 | F | solutions | ✓ | ✓ |
| `plot` | 畫圖 2D：y = f(x) 的點 | {expr, var, a, b, n} | points | ✓ | ✓ |
| `plot3d` | 畫圖 3D：z = f(x, y) 的格點 | {expr, vars, a, b, c, d, n, m} | grid | ✓ | ✓ |
| `plotn` | 畫圖：多個公式在格點上的值（等高線、向量場、複數） | {exprs, vars, ranges, ns, grad, complex} | values | ✓ | ✓ |
| `odeplot` | 畫圖 2D > 常微分方程（y' = f(x, y) 數值解） | {eqs, inits, a, b, n} | ode | ✓ | ✓ |
| `exam` | 工具 > 考卷產生器：一個版本的值 | {formulas, parts, ...} | exam | ✓ | ✓ |
<!-- /ops -->
