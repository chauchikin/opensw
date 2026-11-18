// Sample documents written for opensw (File > Samples). Plain LaTeX, read like any
// Scientific Word 5.x / LaTeX document.
export const SAMPLES = [
  {
    id: 'math-sample',
    label: '數學範例（定理、矩陣、計算）',
    latex: String.raw`
\begin{center}{\Large 數學範例}\end{center}

\section{函數與極限}
設 $f(x)=\dfrac{\sin x}{x}$。當 $x\to 0$ 時，
\[\lim_{x\to 0}\frac{\sin x}{x}=1.\]

\begin{theorem}
若 $f$ 在 $[a,b]$ 上連續，則存在 $c\in[a,b]$ 使得 $f(c)$ 是 $f$ 在 $[a,b]$ 上的最大值。
\end{theorem}

\begin{proof}
由 $[a,b]$ 的緊緻性與 $f$ 的連續性可得。
\end{proof}

\section{矩陣}
令 $A=\begin{pmatrix}2&1\\1&2\end{pmatrix}$，則 $\det A=3$，特徵值是 $1$ 與 $3$。

\section{試試計算}
把游標放在下面的公式裡，按 Ctrl+E（或選單「計算」）：
\begin{enumerate}
\item $\int_0^1 x^2\,dx$
\item $x^2-5x+6=0$（用「解方程」）
\item $(a+b)^3$（用「展開」）
\end{enumerate}
`,
  },
];
