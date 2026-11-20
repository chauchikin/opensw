// Help > Contents: opensw's own manual, written for opensw (not 5.5's help files). It opens as a
// document, so it can be read, searched (Edit > Find), printed or exported like any other.
// Other languages: src/locales/manual.<language>.tex. Its pictures are public/manual/<language>/*.png,
// made by scripts/manual-shots.mjs from the web version.
import { LANG } from './i18n.js';

const TRANSLATED = import.meta.env
  ? import.meta.glob('./locales/manual.*.tex', { query: '?raw', import: 'default', eager: true }) : {};

export const MANUAL = TRANSLATED[`./locales/manual.${LANG}.tex`] || String.raw`\title{opensw manual}
\maketitle

\section{Getting started}

opensw is a math editor rebuilt after Scientific Word 5.5. Its menus, shortcuts and file formats follow 5.5 as closely as possible.

\begin{itemize}
\item The desktop app (Windows) does everything: opening and saving files, typesetting PDF, computing, AI control.
\item The web version can type and compute, but cannot read or write files on the computer directly, and cannot typeset.
\item Press F1 for the keyboard shortcuts. Search this manual with Edit \TEXTsymbol{>} Find (Ctrl+Q).
\end{itemize}

\subsection{The window}

\includegraphics{manual/en/window.png}

\emph{The window with File > Samples > A math sample open.}

\begin{itemize}
\item At the top: the menus and the toolbars. View \TEXTsymbol{>} Toolbars turns each toolbar on or off.
\item On the right: buttons to insert notes, markers, cross references, links, index entries, TeX and HTML fields and exam formulas, and to go back and forth.
\item At the bottom: the tag bar (item tag, section/body tag, text tag where the cursor is), and under it the status bar (Text or Math, the zoom, what an AI is doing).
\item Formulas are red on screen; Tools \TEXTsymbol{>} User setup changes the color. Typesetting prints them black.
\end{itemize}

\section{File}

\includegraphics{manual/en/menu-file.png}

\emph{The File menu.}

\subsection{Opening and saving}

\begin{itemize}
\item Open: 6.x .sci, 5.x .tex and exam templates (.qiz) all work.
\item Save: the main format is 5.x .tex (5.5 can open it; Chinese is saved in Big5). An opened .tex is saved back to the same file, keeping a .bak first; if nothing changed, it is not rewritten. A document opened from a .sci is saved as .sci.
\item Save as .sci: the 6.x format, for those who need it.
\item Before saving over an old file, a .bak copy is kept (it can be turned off in Tools \TEXTsymbol{>} User setup).
\item Open location: an address ending in .tex or .sci opens here; other addresses open in the browser. Add ${'`'}${'`'} as .tex'' after an address to open a file without a .tex ending as a document.
\item Recent files (desktop app), Samples, Document info (words, formulas, pictures).
\end{itemize}

\subsection{Fragments}

A fragment is a saved piece of text and formulas that can be put into any document. Like 5.5's .frg files, it holds 5.x LaTeX.

\begin{itemize}
\item Save as fragment: select the content first, then give it a name.
\item Import fragment: pick one from the list to insert at the cursor. .frg files from 5.5's Frags folder can be added too.
\item The ${'`'}${'`'}Fragments…'' list on the toolbar inserts them as well. A few physical constants are built in.
\item As in 5.5, holding Ctrl and typing a fragment's name (two or more letters or digits, without its folder) inserts it when Ctrl is let go. A name cannot begin with C, V, X, A, Z or Y: those keep Copy, Paste, Cut, Select All, Undo and Redo.
\item Fragments are kept on this computer and shared by all documents.
\end{itemize}

\subsection{Importing and exporting}

\begin{itemize}
\item Import picture: PNG, JPG, GIF, SVG and so on.
\item Export LaTeX, HTML, Word (.docx), and Markdown for AI.
\item When exporting Word, formulas become Word equations; numbered formulas have their numbers on the right.
\end{itemize}

\subsection{Page setup, preview, typesetting}

\begin{itemize}
\item Page setup: margins, header, footer, page numbers. Used only for Preview; typesetting PDF is not affected (as in 5.5).
\item Preview (no typesetting): pages as on screen, sent to the system's print preview, to print or save as PDF.
\item Typeset PDF (Ctrl+P, desktop app): makes a PDF with LaTeX. 5.x documents are typeset with the 5.x macros and look as they do from 5.5.
\end{itemize}

\section{Edit}

\begin{itemize}
\item Undo, redo, cut, copy, paste, select all.
\item Paste special: as plain text, as LaTeX (section titles and formulas read as LaTeX), or as one formula.
\item Copy as picture: with the cursor in a formula, copies that formula; with a picture selected, copies the picture. The resolution is in Tools \TEXTsymbol{>} Export settings.
\item Properties (Ctrl+F5): a formula's TeX, a table's alignment and lines, a picture's size and caption, a plot's formula and ranges.
\item Tables: insert or delete rows and columns, merge and split cells. In a table, Tab goes to the next cell.
\item Find (Ctrl+Q), Replace (Ctrl+W): in text and in formulas.
\end{itemize}

\includegraphics{manual/en/menu-edit.png}

\emph{The Edit menu.}

\includegraphics{manual/en/props.png}

\emph{Properties of a formula (Ctrl+F5 with the cursor in it): its TeX, numbering and marker.}

\section{Insert}

\begin{itemize}
\item Math (Ctrl+M, or type \$) starts a formula; a displayed formula is Ctrl+D.
\item Fraction Ctrl+F, radical Ctrl+R, superscript Ctrl+H, subscript Ctrl+L.
\item Operators, brackets, matrices, math names, binomials, decorations (hats, bars, arrows).
\item Tables, table captions.
\item Markers and cross references: put a marker where you want to refer to, then insert a cross reference.
\item Notes: footnotes, margin notes. Click the small number to edit it.
\item Citations, index entries, hypertext links.
\item TeX field: LaTeX written directly; shown grey on screen, used as it is when typesetting.
\item HTML field: used only when exporting HTML.
\item Exam formula: a formula computed only when exams are made (see ${'`'}${'`'}Exam builder'').
\item Spacing, unit names.
\end{itemize}

\includegraphics{manual/en/menu-insert.png}

\emph{The Insert menu.}

\includegraphics{manual/en/matrix.png}

\emph{Insert > Matrix: rows, columns and brackets.}

\section{View, Go, Tag}

\begin{itemize}
\item View: zoom in and out; show or hide markers, index entries, helper lines, TeX fields; toolbars (each can be turned on or off, with ${'`'}${'`'}Reset'').
\item View \TEXTsymbol{>} Changes and LaTeX source (Ctrl+Shift+D; not in 5.5, closed until opened): on the left the document as it was opened, read only; on the right three tabs. Working document: the blocks changed since are tinted, purple where an AI changed them, yellow where you did. LaTeX source: what saving writes, read only and kept up to date; the parts written again are marked, the rest is the file's own text. Changes and errors: each change, to accept (it stays and is no longer shown) or undo (the original comes back); the errors of the last typesetting in plain words, with the block they are in; and a check of derivations: each step $a=b$ of the displayed formulas (also $=b$ on the next line) is proved equal, shown not equal with a point where the two sides differ, or marked as not decided (never called wrong then). Below them, the line-by-line check: every named step (a displayed formula with a \TEXTsymbol{\backslash}label, or one an AI named) with its result (passed, failed, cannot decide, not checked, trusted) and why; a row takes you to its formula, and Check all named steps checks them again.
\item Go: previous section, next section, marker, link (cursor on a link), previous position, next position.
\item Tag: F2 to F12 apply tags (change them in Tag \TEXTsymbol{>} Function keys); item tags (lists, theorems), section/body tags (section, subsection), text tags (bold, emphasized, sizes).
\item Tag \TEXTsymbol{>} Appearance: the screen font, size and color of each tag; typesetting is not affected.
\end{itemize}

\includegraphics{manual/en/menu-view.png}

\emph{The View menu.}

\includegraphics{manual/en/review.png}

\emph{View > Changes and LaTeX source after one sentence was added: the changed paragraph is tinted on both sides.}

\includegraphics{manual/en/review-source.png}

\emph{The LaTeX source tab: what saving writes. It can be read but not changed here.}

\includegraphics{manual/en/review-list.png}

\emph{The Changes and errors tab: accept or undo each change; typesetting errors; checking the steps of a derivation.}

\includegraphics{manual/en/menu-tag.png}

\emph{The Tag menu.}

\includegraphics{manual/en/tag-appearance.png}

\emph{Tag > Appearance: how each tag looks on screen.}

\section{Compute}

Put the cursor in a formula and choose an action from the Compute menu. The result follows the formula. Computing uses SymPy, which takes a few seconds to load the first time; in the desktop app, Tools > Engine Setup can switch to Mathematica installed on this computer. Computing is opensw's own: 5.5 computed with MuPAD, which opensw does not have, so an answer may be written in a different (equal) form from 5.5's, and some commands may give more or fewer answers.

\includegraphics{manual/en/menu-compute.png}

\emph{The Compute menu, with the Calculus submenu open.}

\begin{itemize}
\item Evaluate (Ctrl+E), evaluate numerically, simplify, factor, expand, combine, rewrite.
\item Check equality: whether the two sides of an equation are equal.
\item Solve: exact, numeric, integer, recursion. Solve ODE: exact, numeric.
\item Solve ODE \TEXTsymbol{>} Numeric solves an initial-value problem typed as a one-column matrix, one equation or initial value in each row (for example $y'=-y$ and $y(0)=1$; equations of any order, or a system of them: an equation of order $n$ in $y$ needs the initial values $y(x_0)$, $y'(x_0)$, \ldots, $y^{(n-1)}(x_0)$, as $y''+y=0$, $y(0)=1$, $y'(0)=0$). As in 5.5 it answers ${'`'}${'`'}Functions defined: $y$'': the solution becomes a function, so evaluating $y(1)$ afterwards gives a number, $y$ applied to a column of numbers gives a column of values, and plotting $y$ (Plot 2D \TEXTsymbol{>} Rectangular or ODE) draws the solution.
\item Polynomials: partial fractions, collect by variable.
\item Calculus: differentiate, integrate, integrate by parts, change variable, approximate integral, plot approximate integral, power series, Padé approximant, find extrema, iterate, implicit differentiation.
\item Vector calculus: gradient, divergence, curl, Laplacian, Hessian, Jacobian, Wronskian, scalar potential, vector potential. The basis variables are $x,y,z$ by default; Vector calculus \TEXTsymbol{>} Set basis variables (or Tools \TEXTsymbol{>} Engine Setup) changes them, for $\nabla$ in Evaluate too: with $u,v,w$, $\nabla (cuv)$ is $(cv,cu,0)$.
\item Simplex: maximize, minimize, feasibility, standardize, dual. Type a one-row matrix: the first entry is the objective, the others are constraints; all variables are taken as $\geq 0$.
\item Statistics, Laplace transform, Fourier transform, matrices (determinant, inverse, eigenvalues, rank, null space…).
\item Definitions: for example choose ${'`'}${'`'}New definition'' on $f(x)=x^{2}$; later computations use it. Defining a name with a letter subscript, such as $a_{i}=3i$, asks how to interpret the subscript, as 5.5 does: as a function argument ($a_{2}$ is then $6$, and $i$ on the right is the argument, not the imaginary unit), or as part of the name ($a_{2}$ stays $a_{2}$).
\item Check with Lean: Lean 4 proves the equation (choose a Lean project folder in Tools \TEXTsymbol{>} Lean setup first).
\end{itemize}

\includegraphics{manual/en/compute.png}

\emph{Ctrl+E puts the answer after the formula; Solve writes the solutions after it.}

\subsection{Plots}

Put the cursor in a formula and choose Compute \TEXTsymbol{>} Plot 2D or Plot 3D. Select a finished plot and press Ctrl+F5 to change its formula, ranges and grid. Plots in 5.5 files are drawn again from their own settings.

\begin{itemize}
\item 2D rectangular: $y=f(x)$. Its properties can switch to a logarithmic or log-log scale.
\item 2D polar: $r=f(\theta)$, or the two components $(r,\theta)$.
\item 2D implicit: an equation, for example $x^{2}+y^{2}=4$.
\item 2D parametric: $(x(t),y(t))$.
\item 2D conformal: a complex function, for example $\frac{z-1}{z+1}$, showing where the function takes a grid.
\item 2D gradient: the gradient arrows of $f(x,y)$. 2D vector field: $[P,Q]$.
\item 2D inequality: for example $x+y^{2}<5$, shading the region where it holds.
\item 2D ODE: type the equation and the initial value as a one-row matrix, for example $y'=\sin (xy)$ and $y(0)=3$; the solution is drawn numerically. Systems work too.
\item Approximate integral plot: Compute \TEXTsymbol{>} Calculus \TEXTsymbol{>} Plot approximate integral, with left endpoints, midpoints, right endpoints, upper sum, lower sum or trapezoids.
\item 3D rectangular: $z=f(x,y)$, or a parametric surface $(x(s,t),y(s,t),z(s,t))$.
\item 3D cylindrical: $r=f(\theta ,z)$; spherical: $\rho =f(\theta ,\varphi )$. Three components work too.
\item 3D implicit: an equation, for example $x^{2}+y^{2}+z^{2}=9$.
\item 3D tube: a tube along the curve $(x(t),y(t),z(t))$; the radius is in its properties.
\item 3D gradient, 3D vector field $[P,Q,R]$.
\end{itemize}

\includegraphics{manual/en/plots.png}

\emph{Plot 2D > Rectangular and Plot 3D > Rectangular, each on the formula above it.}

\includegraphics{manual/en/plot-props.png}

\emph{A plot's properties (select it, Ctrl+F5): the formula, its color, another function, the ranges.}

\section{Typeset}

\begin{itemize}
\item Typeset PDF (desktop app): uses XeLaTeX when it is installed, otherwise the bundled Tectonic. The usual TeX files come with the program, so typesetting works without the internet; a package outside them is downloaded the first time it is used. Chinese can be typeset.
\item Preamble: the LaTeX preamble used for typesetting (\TEXTsymbol{\backslash}usepackage and so on).
\item Options: document class, font size, paper, packages.
\end{itemize}

\section{Tools}

\includegraphics{manual/en/menu-tools.png}

\emph{The Tools menu.}

\subsection{Exam builder}

Uses the current document as a template to make several versions of an exam, with different numbers, and their answers. The template is 5.5's exam format (.qiz), with section titles as keywords:

\begin{itemize}
\item Exam (or Quiz, Test): marks the document as an exam template. Comment: a note only, not in the exams.
\item Text: text put into the exam as it is. Part: divides the exam into parts, each with its own setup.
\item Setup: settings. For example $a:=\func{rand}(1,9)$ (computed once), $b=1/a$ (computed again each time it is used), ${'`'}${'`'}Condition: $(a\neq b)$'' (draw again until it holds), ${'`'}${'`'}Questions: number, permute'' (number and shuffle the questions), ${'`'}${'`'}Choices: permute'' (shuffle the choices), ${'`'}${'`'}Seed: 123'' (fixed random numbers). The keywords are 5.5's: ${'`'}${'`'}Questions: Number, Permute'' (number the questions, which are not numbered without it; shuffle them), ${'`'}${'`'}Choices: Permute, No Break, Check'' (shuffle the choices; put them on one line, ${'`'}${'`'}Choice Space: 2'' em apart; check boxes, each choice worth the points of its item label such as \TEXTsymbol{\backslash}item[-1]), ${'`'}${'`'}Question Space: 1'' (empty lines after each question), ${'`'}${'`'}Print Choices: a, b, c'' (what a printed exam shows instead of buttons), ${'`'}${'`'}Select: 2'' (in a Question's Setup: how many of its variants to ask), ${'`'}${'`'}Points: 6'' (what a question is worth in the online quiz), ${'`'}${'`'}Text Area: 5, 60'' (the size of a Response area). Compute, CSTFile, Errors and OutputTap are about 5.5's own quiz program and are not used.
\item Random numbers: $\func{rand}()$; $\func{rand}(n)$ is 0 to $n-1$; $\func{rand}(n,m)$ is $n$ to $m$; $\func{rand}(\{2,3,5\})$ picks one from the set; $\func{randmat}(3,3,1,(1,9))$ is a random matrix (third number: 1 any, 2 symmetric, 3 antisymmetric, 4 determinant 1).
\item Question: one question. Statement: the question. Substatement: a part of it. Response: a list of choices, or a blank (write InputField). Put \TEXTsymbol{\backslash}correctchoice (a TeX field) after the correct choice. A choice tagged fixed stays last.
\item Answer, Solution: only in the answers. Variant: another wording of the same question; one is picked at random.
\item Where a question needs a number, use Insert \TEXTsymbol{>} Exam formula, for example $a+b$; it is computed when the exams are made.
\end{itemize}

The exams open as a new document, with the template's pictures; the template stays in the Window menu.

Online quiz (a box in the dialog): one version is also saved as a web page to answer in a browser: choices as buttons (check boxes with ${'`'}${'`'}Choices: Check'', pictures with ${'`'}${'`'}Images: first.bmp, next.bmp''), InputField as a box, a Response section as a text area. ${'`'}${'`'}Title'' is the page's title and ${'`'}${'`'}Submit'' its button. Without Action the page grades itself (the key is in the page, only encoded, so it is for practice): a box is right when it has the values of GradeProc's ${'`'}${'`'}givecredit(response = ...)'' (or else the Answer's text). With ${'`'}${'`'}Action: address'' (${'`'}${'`'}Method: post'' or get, ${'`'}${'`'}Database'', ${'`'}${'`'}ItemId'', ${'`'}${'`'}Record: Never, Always or Student Choice''), the page sends the answers to that address, for a grading server of your own; 5.5 sent them to MacKichan's server program, which no longer exists.

\subsection{Other tools}

\begin{itemize}
\item Spelling: goes through the words not in the English dictionary (5.5's en-US dictionary), one at a time: Change, Change all, Ignore, Ignore all, Add to dictionary. Spell check (at the end of the menu): the browser's own underlining.
\item Save user preferences, Restore saved preferences: every setting of opensw (function keys, tag appearance, fragments, the dictionary's added words ...) as one .json file, to take to another computer.
\item Document manager: lists the pictures and subdocuments the document uses and whether they were found; packs them into a .zip (.sci, 5.x .tex and pictures together) to give to others; opens a .zip or a 5.5 .rap package. In the desktop app, as 5.5: Copy (the saved document and its files to another folder), Rename, Delete and Clean Up auxiliary files (.aux, .log, .bak ...); deleted files go to the Recycle Bin, and each file beside the document can be left out.
\item Automatic substitution: a string of letters typed in a formula (for example sum10) becomes a formula. It can be turned off.
\item User setup: default matrix and table sizes, the document shown when the program opens, keeping .bak files, the formula color, the interface language.
\item Export settings: MathML or MathJax for formulas in HTML; the resolution of Copy as picture.
\item Engine setup: choose SymPy or Mathematica (desktop app, installed on the computer) and see the versions. Lean setup: the Lean project folder.
\item Engine setup also holds the settings that change answers, as 5.5's computation setup: Solve gives the principal value only; the base for the log function changes from $e$ to $10$ ($\log x$ is then $\log_{10}x$, and Evaluate shows it so; $\ln$ stays the natural logarithm); the basis variables of vector calculus and $\nabla$ (default $x,y,z$).
\end{itemize}

\includegraphics{manual/en/user-setup.png}

\emph{Tools > User setup.}

\includegraphics{manual/en/engine.png}

\emph{Tools > Engine Setup: the engine and the settings that change answers.}

\section{Window}

Several documents can be open at once. Switch in the Window menu; Ctrl+F6 or Ctrl+Tab goes to the next one. File > Close (Ctrl+F4) or the × at the right end of the menu bar closes the one on screen, asking first whether to save its changes; Window > Close All closes them all.

\section{Help}

\begin{itemize}
\item Keyboard shortcuts (F1): the table of 5.5's shortcuts. F1 again closes it.
\item Full manual: this document.
\item How to use: a short guide on one page.
\item Talking to AI: examples of what to ask an AI app (see ${'`'}${'`'}Letting AI help'').
\end{itemize}

\includegraphics{manual/en/shortcuts.png}

\emph{Help > Keyboard shortcuts (F1).}

\includegraphics{manual/en/guide.png}

\emph{Help > How to use.}

\section{5.5 files}

\begin{itemize}
\item Formulas, theorems, lists, tables, pictures, plots, footnotes, citations, index entries, subdocuments and exam formulas are all read.
\item 5.x commands that are not recognised are kept as they are in grey TeX fields, and saving and exporting keep them.
\item Pictures must be next to the .tex (or in a graphics folder). The web version cannot read pictures on the computer; use the desktop app, or open a package with the Document manager.
\item A document saved back as 5.x .tex opens in 5.5.
\end{itemize}

\section{Letting AI help}

In the desktop app, an AI app such as Claude or ChatGPT can read the open document, change it, compute and typeset (through MCP).

\begin{enumerate}
\item Tools $>$ Connect AI: tick Claude or ChatGPT / Codex and press OK. opensw adds itself to that app's settings (keeping a copy of the old settings). Quit the AI app completely and open it again.
\item Ask in your own words, for example: ${'`'}${'`'}Read the document open in opensw and tell me what it is about'', ${'`'}${'`'}Fix the typos, but do not change the formulas'', ${'`'}${'`'}Compute the integral in the third formula and write the answer after it''. Help $>$ Talking to AI has more.
\item While the AI works the status bar says so, and the paragraphs it changed are tinted. Edit $>$ Undo AI Changes (or the button in the status bar) puts the document back as it was, in one step.
\end{enumerate}

The AI can open and save only in the open document's folder, Documents\textbackslash{}opensw (where it can save a new document without asking) and the folders allowed in Tools $>$ User Setup; anywhere else opensw asks you first. It saves only .tex and .sci files. The details for setting it up by hand are in docs/AI.md in the source code.

On a computer where no AI app can be installed, or in a script, the same commands can be typed in a terminal with opensw-cli.exe, which is next to opensw.exe. For example, opensw-cli help lists the commands, and opensw-cli save saves the open document. They go to the open editor (it opens if it is not running), with the same folders allowed.

\section{About}

opensw is licensed under the Mozilla Public License 2.0 (versions up to 0.8.0: MIT). Its code is written anew and uses no code, icons or help files from Scientific Word. Scientific Word is a trademark of MacKichan Software, which has nothing to do with opensw.
`;
