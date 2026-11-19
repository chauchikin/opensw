// Demo documents written for opensw (File > Samples): problems to try each part of the Compute
// menu on, each with the menu command to use and its answer. The words are English here and
// translated by src/locales/<language>.json; the formulas are the same in every language.
// Every problem is also a case of scripts/engine-cases.mjs, so engine-check proves the answers
// for each computation engine, and test/demos.mjs opens the documents and finds each menu command.
//
// A problem: { op, latex, params?, how: [menu, item, ...], answer, expect, by? }
//   op, params  what the menu command sends to the engine (as src/compute.js, see src/api.js)
//   how         the menu path, as the menus write it (English)
//   answer      the answer shown in the document (LaTeX)
//   expect, by  what engine-check looks for in the engine's answer (see scripts/engine-cases.mjs)
// A problem with no op (a plot) is shown and its menu command checked, but not sent to an engine.

const EVAL = ['Compute', 'Compute'];
const NUMERIC = ['Compute', 'Evaluate numerically'];
const CALC = (item) => ['Compute', 'Calculus', item];

export const DEMOS = [
  {
    id: 'demo-calculus',
    label: 'Demo: calculus',
    title: 'Calculus Problems to Try',
    intro: 'Put the cursor in a formula and choose the menu command written after it. The answer opensw should give is shown below each problem.',
    sections: [
      {
        title: 'Derivatives and limits',
        problems: [
          { op: 'evaluate', latex: '\\frac{d}{dx}\\left(x^{2}\\sin x\\right)', how: EVAL, answer: '2x\\sin x+x^{2}\\cos x',
            expect: ['x^2\\cos(x)+2x\\sin(x)', 'x^2\\cosx+2x\\sinx', '2x\\sin(x)+x^2\\cos(x)', '2x\\sinx+x^2\\cosx'] },
          { op: 'evaluate', latex: '\\lim_{x\\to\\infty}\\left(1+\\frac{2}{x}\\right)^{x}', how: EVAL, answer: 'e^{2}', expect: 'e^2' },
          { op: 'evaluate', latex: '\\lim_{x\\to 0}\\frac{1-\\cos x}{x^{2}}', how: EVAL, answer: '\\frac{1}{2}', expect: '\\frac{1}{2}' },
          { op: 'implicitdiff', latex: 'x^{2}+y^{2}=25', how: CALC('Implicit differentiation'), answer: "y'=-\\frac{x}{y}", expect: ['-\\frac{x}{y}'] },
        ],
      },
      {
        title: 'Integrals',
        problems: [
          { op: 'evaluate', latex: '\\int_{0}^{\\pi}\\sin x\\,dx', how: EVAL, answer: '2', expect: '2' },
          { op: 'evaluate', latex: '\\int x e^{-x}\\,dx', how: EVAL, answer: '-\\left(x+1\\right)e^{-x}', expect: ['(-x-1)e^{-x}', '-(x+1)e^{-x}', 'e^{-x}(-x-1)', '-e^{-x}(1+x)', '-e^{-x}(x+1)', '-xe^{-x}-e^{-x}'] },
          { op: 'evaluate', latex: '\\int_{0}^{\\infty}e^{-x^{2}}\\,dx', how: EVAL, answer: '\\frac{\\sqrt{\\pi}}{2}', expect: ['\\frac{\\sqrt{\\pi}}{2}', '\\frac{1}{2}\\sqrt{\\pi}'] },
          { op: 'byparts', latex: '\\int x\\cos x\\,dx', params: ['x'], how: CALC('Integrate by parts…'), answer: 'x\\sin x-\\int\\sin x\\,dx', expect: '\\int' },
          { op: 'approxint', latex: '\\int_{0}^{1}\\frac{4}{1+x^{2}}\\,dx', params: ["'simpson'", '4'], how: CALC('Approximate integral…'), answer: '3.1416', expect: '3.141' },
        ],
      },
      {
        title: 'Series and extrema',
        problems: [
          { op: 'evaluate', latex: '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}', how: EVAL, answer: '\\frac{\\pi^{2}}{6}', expect: ['\\frac{\\pi^2}{6}', '\\frac{1}{6}\\pi^2'] },
          { op: 'series', latex: '\\cos x', params: ['x', '6'], how: CALC('Power series…'), answer: '1-\\frac{x^{2}}{2}+\\frac{x^{4}}{24}-\\frac{x^{6}}{720}+O\\left(x^{7}\\right)', expect: ['\\frac{x^4}{24}', '\\frac{1}{24}x^4'] },
          { op: 'extrema', latex: 'x^{3}-3x', how: CALC('Find extrema'), answer: 'x=-1\\ (f=2),\\quad x=1\\ (f=-2)', expect: 'x=1' },
        ],
      },
      {
        title: 'Differential equations',
        text: 'The second problem defines the solution y, so that y(1) can then be computed.',
        problems: [
          { op: 'ode', latex: "y''+4y=0", how: ['Compute', 'Solve ODE', 'Exact'], answer: 'y(x)=C_{1}\\sin 2x+C_{2}\\cos 2x', expect: ['\\sin(2x)', '\\sin2x'] },
          { op: 'odenumeric', latex: "\\begin{pmatrix}y'=y\\\\y(0)=1\\end{pmatrix}", how: ['Compute', 'Solve ODE', 'Numeric'], expect: 'y' },
          { op: 'evaluate', latex: 'y(1)', how: EVAL, answer: '2.7183', expect: '2.718' },
        ],
      },
    ],
  },
  {
    id: 'demo-algebra',
    label: 'Demo: algebra and matrices',
    title: 'Algebra and Matrix Problems to Try',
    intro: 'Put the cursor in a formula and choose the menu command written after it. The answer opensw should give is shown below each problem.',
    sections: [
      {
        title: 'Polynomials and equations',
        problems: [
          { op: 'factor', latex: 'x^{4}-16', how: ['Compute', 'Factor'], answer: '\\left(x-2\\right)\\left(x+2\\right)\\left(x^{2}+4\\right)', expect: ['(x-2)(x+2)(x^2+4)', '(x+2)(x-2)(x^2+4)', '(-2+x)(2+x)(4+x^2)'] },
          { op: 'expand', latex: '\\left(2x-1\\right)^{4}', how: ['Compute', 'Expand'], answer: '16x^{4}-32x^{3}+24x^{2}-8x+1', expect: ['16x^4-32x^3+24x^2-8x+1', '1-8x+24x^2-32x^3+16x^4'] },
          { op: 'simplify', latex: '\\frac{x^{3}-1}{x-1}', how: ['Compute', 'Simplify'], answer: 'x^{2}+x+1', expect: ['x^2+x+1', '1+x+x^2'] },
          { op: 'partialfractions', latex: '\\frac{x+5}{x^{2}+x-2}', how: ['Compute', 'Polynomials', 'Partial fractions'], answer: '\\frac{2}{x-1}-\\frac{1}{x+2}', expect: ['\\frac{2}{x-1}', '\\frac{2}{-1+x}'] },
          { op: 'solve', latex: 'x^{3}-6x^{2}+11x-6=0', how: ['Compute', 'Solve (exact)'], answer: 'x=1,\\ x=2,\\ x=3', expect: ['1;2;3'] },
          { op: 'solve', latex: '\\begin{pmatrix}2x+y=7\\\\x-y=2\\end{pmatrix}', how: ['Compute', 'Solve (exact)'], answer: 'x=3,\\ y=1', expect: ['x=3,y=1', 'x=3'] },
          { op: 'numericsolve', latex: '\\begin{array}{c}\\cos x=x\\\\x\\in\\left(0,1\\right)\\end{array}', how: ['Compute', 'Solution', 'Numeric'], answer: 'x=0.73909', expect: 'x=0.7390' },
          { op: 'integersolve', latex: '2x+3y=7', how: ['Compute', 'Solution', 'Integer'], answer: 'x=3t-7,\\ y=7-2t', expect: ['x=3', 'x=2+3', 'x=-7+3'] },
        ],
      },
      {
        title: 'Definitions',
        text: 'Define f first (the first problem below); the other problems then use it.',
        problems: [
          { op: 'define', latex: 'f(x)=x^{2}-4x+1', how: ['Compute', 'Definition', 'New definition'], expect: 'f(x)=' },
          { op: 'evaluate', latex: 'f(5)', how: EVAL, answer: '6', expect: '6' },
          { op: 'evaluate', latex: '\\frac{d}{dx}f(x)', how: EVAL, answer: '2x-4', expect: ['2x-4', '-4+2x'] },
        ],
      },
      {
        title: 'Matrices',
        problems: [
          { op: 'determinant', latex: '\\begin{pmatrix}4&1\\\\2&3\\end{pmatrix}', how: ['Compute', 'Matrices', 'Determinant'], answer: '10', expect: '10' },
          { op: 'inverse', latex: '\\begin{pmatrix}4&1\\\\2&3\\end{pmatrix}', how: ['Compute', 'Matrices', 'Inverse'],
            answer: '\\begin{pmatrix}\\frac{3}{10}&-\\frac{1}{10}\\\\-\\frac{1}{5}&\\frac{2}{5}\\end{pmatrix}', expect: '\\frac{3}{10}' },
          { op: 'eigenvalues', latex: '\\begin{pmatrix}4&1\\\\2&3\\end{pmatrix}', how: ['Compute', 'Matrices', 'Eigenvalues'], answer: '2,\\ 5', expect: ['\\{2,5\\}', '\\{5,2\\}'] },
          { op: 'evaluate', latex: '\\begin{pmatrix}4&1\\\\2&3\\end{pmatrix}^{2}', how: EVAL, answer: '\\begin{pmatrix}18&7\\\\14&11\\end{pmatrix}', expect: '\\begin{pmatrix}18&7\\\\14&11\\end{pmatrix}' },
          { op: 'rank', latex: '\\begin{pmatrix}1&2&3\\\\2&4&6\\\\1&0&1\\end{pmatrix}', how: ['Compute', 'Matrices', 'Rank'], answer: '2', expect: '2' },
        ],
      },
    ],
  },
  {
    id: 'demo-more',
    label: 'Demo: vectors, statistics and more',
    title: 'Vector Calculus, Statistics, Transforms and Linear Programming',
    intro: 'Put the cursor in a formula and choose the menu command written after it. The answer opensw should give is shown below each problem.',
    sections: [
      {
        title: 'Vector calculus',
        text: 'The variables are x, y, z; Set basis variables in the vector calculus menu changes them.',
        problems: [
          { op: 'gradient', latex: 'x^{2}y+yz', params: ['x', 'y', 'z'], how: ['Compute', 'Vector calculus', 'Gradient'], answer: '\\begin{pmatrix}2xy\\\\x^{2}+z\\\\y\\end{pmatrix}', expect: ['\\begin{pmatrix}2xy\\\\x^2+z\\\\y\\end{pmatrix}', '\\begin{pmatrix}2xy\\\\z+x^2\\\\y\\end{pmatrix}'] },
          { op: 'divergence', latex: '\\begin{pmatrix}x^{2}\\\\xy\\\\z\\end{pmatrix}', params: ['x', 'y', 'z'], how: ['Compute', 'Vector calculus', 'Divergence'], answer: '3x+1', expect: ['3x+1', '1+3x'] },
          { op: 'curl', latex: '\\begin{pmatrix}y\\\\-x\\\\0\\end{pmatrix}', params: ['x', 'y', 'z'], how: ['Compute', 'Vector calculus', 'Curl'], answer: '\\begin{pmatrix}0\\\\0\\\\-2\\end{pmatrix}', expect: '\\begin{pmatrix}0\\\\0\\\\-2\\end{pmatrix}' },
          { op: 'laplacian', latex: 'x^{2}+y^{2}+z^{2}', params: ['x', 'y', 'z'], how: ['Compute', 'Vector calculus', 'Laplacian'], answer: '6', expect: '6' },
        ],
      },
      {
        title: 'Statistics',
        text: 'The data are written as one row.',
        problems: [
          { op: 'mean', latex: '\\begin{pmatrix}2&4&4&4&5&5&7&9\\end{pmatrix}', how: ['Compute', 'Statistics', 'Mean'], answer: '5', expect: '5' },
          { op: 'median', latex: '\\begin{pmatrix}2&4&4&4&5&5&7&9\\end{pmatrix}', how: ['Compute', 'Statistics', 'Median'], answer: '\\frac{9}{2}', expect: ['\\frac{9}{2}', '4.5'] },
          { op: 'variance', latex: '\\begin{pmatrix}2&4&4&4&5&5&7&9\\end{pmatrix}', how: ['Compute', 'Statistics', 'Variance'], answer: '\\frac{32}{7}', expect: ['\\frac{32}{7}', '4'] },
        ],
      },
      {
        title: 'Laplace transforms',
        problems: [
          { op: 'laplace', latex: '\\sin 3t', how: ['Compute', 'Transforms', 'Laplace transform'], answer: '\\frac{3}{s^{2}+9}', expect: ['\\frac{3}{s^2+9}', '\\frac{3}{9+s^2}'] },
          { op: 'laplace', latex: 'te^{-t}', how: ['Compute', 'Transforms', 'Laplace transform'], answer: '\\frac{1}{\\left(s+1\\right)^{2}}', expect: ['\\frac{1}{(s+1)^2}', '\\frac{1}{(1+s)^2}'] },
          { op: 'inverselaplace', latex: '\\frac{1}{s^{2}+1}', how: ['Compute', 'Transforms', 'Inverse Laplace transform'], answer: '\\sin t', expect: ['\\sin(t)', '\\sint'] },
        ],
      },
      {
        title: 'Linear programming',
        text: 'The first row is the objective, the other rows the constraints; all variables are at least 0.',
        problems: [
          { op: 'maximize', latex: '\\begin{pmatrix}3x+2y\\\\x+y\\leq 4\\\\x\\leq 3\\end{pmatrix}', how: ['Compute', 'Simplex', 'Maximize'], answer: '11\\quad\\left(x=3,\\ y=1\\right)', expect: '11' },
        ],
      },
      {
        title: 'Plots',
        text: 'A plot is made below the formula; double-click it to change its settings.',
        problems: [
          { latex: '\\sin x+\\frac{1}{2}\\sin 2x', how: ['Compute', 'Plot 2D', 'Rectangular'] },
          { latex: '1+\\cos\\theta', how: ['Compute', 'Plot 2D', 'Polar'] },
          { latex: 'x^{2}+y^{2}=4', how: ['Compute', 'Plot 2D', 'Implicit'] },
          { latex: 'x^{2}-y^{2}', how: ['Compute', 'Plot 3D', 'Rectangular'] },
        ],
      },
    ],
  },
];

// the words of the demos, to translate (scripts/i18n-keys.mjs)
export function demoPhrases() {
  const s = new Set(['Answer:']);
  for (const d of DEMOS) {
    [d.label, d.title, d.intro].forEach((x) => s.add(x));
    for (const t of d.sections) { s.add(t.title); if (t.text) s.add(t.text); t.problems.forEach((p) => p.how.forEach((h) => s.add(h))); }
  }
  return [...s];
}

// every problem of the demos, in order, as [demo, problem]
export const demoProblems = () => DEMOS.flatMap((d) => d.sections.flatMap((s) => s.problems.map((p) => [d, p])));

// a demo as LaTeX; t translates a phrase (src/i18n.js _t)
export function demoLatex(demo, t = (s) => s) {
  const menu = (how) => how.map(t).join(' \\textgreater{} ');
  const out = [`\\begin{center}{\\Large ${t(demo.title)}}\\end{center}`, '', t(demo.intro), ''];
  for (const s of demo.sections) {
    out.push(`\\section{${t(s.title)}}`);
    if (s.text) out.push(t(s.text), '');
    out.push('\\begin{enumerate}');
    for (const p of s.problems) {
      out.push(`\\item $${p.latex}$ \\quad \\textbf{${menu(p.how)}}`);
      if (p.answer) out.push('', `${t('Answer:')} $${p.answer}$`);
    }
    out.push('\\end{enumerate}', '');
  }
  return out.join('\n') + '\n';
}
