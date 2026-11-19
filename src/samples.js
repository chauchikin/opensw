// Sample documents written for opensw (File > Samples), and the demo documents of src/demos.js. Plain LaTeX, read like any
// Scientific Word 5.x / LaTeX document. Other languages: src/locales/sample.<language>.tex.
import { _t, LANG } from './i18n.js';
import { DEMOS, demoLatex } from './demos.js';

const TRANSLATED = import.meta.env
  ? import.meta.glob('./locales/sample.*.tex', { query: '?raw', import: 'default', eager: true }) : {};
export const SAMPLES = [
  {
    id: 'math-sample',
    label: _t('A math sample (theorems, matrices, computing)'),
    latex: TRANSLATED[`./locales/sample.${LANG}.tex`] || String.raw`
\begin{center}{\Large A Math Sample}\end{center}

\section{Functions and limits}
Let $f(x)=\dfrac{\sin x}{x}$. As $x\to 0$,
\[\lim_{x\to 0}\frac{\sin x}{x}=1.\]

\begin{theorem}
If $f$ is continuous on $[a,b]$, then there is a $c\in[a,b]$ such that $f(c)$ is the maximum of $f$ on $[a,b]$.
\end{theorem}

\begin{proof}
It follows from the compactness of $[a,b]$ and the continuity of $f$.
\end{proof}

\section{Matrices}
Let $A=\begin{pmatrix}2&1\\1&2\end{pmatrix}$. Then $\det A=3$, and the eigenvalues are $1$ and $3$.

\section{Try computing}
Put the cursor in a formula below and press Ctrl+E (or use the Compute menu):
\begin{enumerate}
\item $\int_0^1 x^2\,dx$
\item $x^2-5x+6=0$ (use ${'`'}${'`'}Solve'')
\item $(a+b)^3$ (use ${'`'}${'`'}Expand'')
\end{enumerate}
`,
  },
  // the demos: problems for each part of the Compute menu, in the interface language
  ...DEMOS.map((d) => ({ id: d.id, label: _t(d.label), get latex() { return demoLatex(d, _t); } })),
];
