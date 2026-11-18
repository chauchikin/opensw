# SW6 `.sci` / `main.xhtml` tag reference and LaTeX export behaviour

This file is a reference for building "opensw", an editor that reads and writes Scientific Word 6 files.
Source: the Scientific Word source code published by MacKichan Software (github.com/ScientificWord/mozilla).
Snapshot date: 2026-11-18.

## 0. How to read this file

Evidence marks:

- **[V: path]**: verified in that source file. Quoted lines are copied from it, sometimes shortened.
- **[V: sample]**: seen in a shipped sample or shell `.sci` (listed in §14).
- **[I]**: inferred. This comes from reading code paths without running SW6. Treat it as likely, not proven.

Short names for the files used most:

| Short | Path | Role |
|---|---|---|
| `L` | `filters/prnc2ltx/latex.xsl` | main LaTeX export stylesheet |
| `P` | `filters/prnc2ltx/preamble.xsl` | preamble, packages, page layout |
| `SP` | `filters/prnc2ltx/spaces.xsl` | spaces, breaks, rules |
| `FR` | `filters/prnc2ltx/frame.xsl` | `msiframe` (figures, tables, text frames) |
| `GR` | `filters/prnc2ltx/graphics.xsl` | `object`/`embed` → `\includegraphics`, plot wrappers |
| `M` | `filters/prnc2ltx/MML2LTeX.xsl` | MathML → LaTeX (includes `mi.xsl`, `mo.xsl`, `MML2eqna.xsl`, …) |
| `EQ` | `filters/prnc2ltx/MML2eqna.xsl` | multi-line displays (align/gather/multline/alignat) |
| `TX` | `filters/prnc2ltx/texescape.xsl` | escaping of plain text |
| `AMS` | `filters/prnc2ltx/amscls.xsl` | extra templates for amsart/amsbook (includes `L`) |
| `TD` | `prince/res/tagdefs/latexdefs.xml` | tag definitions (tag classes, allowed children, initial content) |
| `XO` | `filters/ptprince/ptdata/msi-xmlout.tex` | **LaTeX importer**: what XML each LaTeX command becomes |
| `LD` | `filters/ptprince/ptdata/msi-latex-default.tex` | importer: simple LaTeX→XML name map |
| `LI` | `filters/ptprince/ptdata/msi-latexin.tex` | importer: `\index`, `\CustomNote`, `\hyperref` |
| `TO` | `prince/base/content/typesetOverlay.js` | creates citations, bibliographies, cross-references |
| `CC` | `prince/base/content/msiComposerCommands.js` | creates notes, revises structure tags |
| `PJ` | `prince/base/content/prince.js` | runs the export (`documentAsTeXFile`, `documentToTeXString`) |

### 0.1 Export pipeline (applies to every section below)

- Export uses Mozilla's built-in XSLT 1.0 engine (`XSLTProcessor`) on the live DOM. **[V: PJ `documentToTeXString`]**
- Choosing the stylesheet: a processing instruction `<?sw-xslt href="amscls.xsl" type="text/xml" ?>` picks it. With no such PI, `latex.xsl` is used. Other stylesheets: `amscls.xsl`, `revtex4-1.xsl`, `revtex4-2.xsl`, `beamer.xsl`. Each one does `<xsl:include href="latex.xsl"/>` and overrides a few templates. **[V: PJ `documentAsTeXFile`; AMS line 10]**
- Line breaks: templates write the tokens `\MsiNewline` and `\MsiBlankline`. JS post-processing then does this: collapse whitespace around each `\n`, collapse runs of `\n`, turn `\MsiNewline` into one `\n`, and turn `\MsiBlankline` into `\n\n`. So the line breaks in the XSL source mostly have no effect. **[V: PJ lines 1430–1434]**
- Characters: the C++ `FilterCharsForLaTeX` runs last. For the `pdflatex` compiler (`<texprogram prog>` is not set, or is `pdflatex`) it turns non-ASCII into TeX macros. If the document contains `\usepackage[utf8]{inputenc}`, Latin-1 characters are kept as they are. A character with no mapping is written as `{\small\fbox{HEX}}`. **[V: `editor/libeditor/html/nsHTMLEditor.cpp` ~7427]**
- The compiler choice comes from the first `<texprogram prog="pdflatex|xelatex|lualatex">`. **[V: PJ]**
- Number of LaTeX passes: 3 if the output contains `\tableofcontents`, a list of figures/tables, or `\includemovie`; at least 2 for `\ref`/`\cite`/…; 3 if `\printindex` or `\bibliography` is present. A higher number can come from `<button minpasses="N">`. **[V: PJ]**
- **The catch-all template `<xsl:template match="*"/>` is empty.** An element with no template is dropped *together with all of its content*, without any warning. **[V: L line 144]** For the elements this affects, see §12.
- Plain text (default mode) is escaped. **[V: TX]**

  | Character | Becomes | Character | Becomes |
  |---|---|---|---|
  | `\` | `$\backslash$` | `~` | `\symbol{126}` |
  | `$` | `\$` | `^` | `\symbol{94}` |
  | `{` `}` | `\{` `\}` | `#` | `\#` |
  | `&` | `\&` | `%` | `\%` |
  | `_` | `\_` | `|` | `\textbar{}` |
  | `<` `>` | `\textless{}` `\textgreater{}` | U+2013/2014 | `--` / `---` |
  | U+201C/201D | ` `` ` / `''` | U+2026 | `\ldots{}` |
  | U+00A0 | space | U+20AC | `\texteuro{}` |
  | U+2190–2193 | `\textleftarrow{}` etc. | | |

  In modes `tex` and `verb` (TeX fields, verbatim) text is copied raw. In mode `texcomment` every newline is followed by `% `.
- Template conflicts: when two templates have equal priority, the XSLT 1.0 rule applies and the later one wins. This matters for `<note>` (§1). **[I]**

---

## 1. Notes (footnotes, margin notes, other notes, hidden notes)

### 1.1 Storage

```xml
<notewrapper type="footnote" markOrText="markOnly" footnoteNumber="5">
  <note type="footnote" hide="false" style="padding: 10px;" [ragrt="true"] [raglft="true"]>
    <bodyText>…</bodyText>
  </note>
</notewrapper>
```

| Element / attr | Meaning / values | Evidence |
|---|---|---|
| `notewrapper` | Inline wrapper that holds exactly one `note`. TD: `othertag`, `wrapper=true`, `contains note`. Allowed inside paragraphs, `biblabel`, `shortTitle`, `envLeadIn`. | [V: TD; CC `msiInsertOrReviseNote`] |
| `notewrapper/@type` | `"footnote"` only for footnotes; removed for other note types. | [V: CC ~11097] |
| `notewrapper/@markOrText` | `markOnly` \| `textOnly`. Left out for the default `markAndText`. The importer writes `"undefined"` (for `\thanks`). | [V: CC; XO `\out@thanks`] |
| `notewrapper/@footnoteNumber` | Integer that overrides the automatic number. | [V: CC; `dialogs/NoteOptionsDialog.js`] |
| `note/@type` | Values from the Note dialog: `footnote`, `marginnote`, `marginhint`, `solutionnote`, `problemhint`, `note`, `answernote`. The importer also writes `marginpar` (from `\marginpar`) and any name passed to `\CustomNote{type}{…}`. | [V: `dialogs/Note.xul` lines 39–45; XO `\out@marginparB`, `\out@CustomNoteB`] |
| `note/@hide` | `"true"`/`"false"`. **Display only**: CSS `note[hide=true]{display:none}`. Body attributes `hideFootnotes="true"` and `hideOtherNotes="true"` hide notes on screen. | [V: `prince/res/css/baselatex.css` 494–517] |
| `note/@ragrt`, `@raglft` | `"true"`: ragged-right / ragged-left margin note. If both are set, `ragrt` wins. | [V: `dialogs/Note.js`, CC] |
| `note/@opt` | Importer only: the optional left-margin text of `\marginpar[left]{right}`. | [V: XO `\out@marginparA`] |
| children | One or more `bodyText` (other paragraph tags are allowed by TD). | [V: TD initial content] |
| Hidden envtag `note` | TD also defines `note` as an `envtag` (Insert menu), initial content `<note style="padding: 10px;"><bodyText/></note>`. Same element name. | [V: TD] |

### 1.2 LaTeX output

| Case | Output | Evidence |
|---|---|---|
| `note[@type='footnote']`, endnotes on | `\protect\endnote[N]{…}` | [V: L 992–1018] |
| …, `markOrText="textOnly"` | `\protect\footnotetext[N]{…}` | same |
| …, `markOrText="markOnly"` | `\protect\footnotemark[N]` (body not written) | same |
| …, default | `\protect\footnote[N]{…}`. `[N]` appears only if the wrapper has `@footnoteNumber`. | same |
| any other `note` (all non-footnote types) | `\marginpar{` + optional `\RaggedRight ` / `\RaggedLeft ` + content + `}` | [V: L 1020–1035] |
| Endnotes mode | Turned on when `//endnotes[@val='end']` exists (written by Document Format into `<docformat>` with `req="endnotes"`). Then `\theendnotes` is written before `\end{document}` if at least one footnote exists. | [V: L 112, 402–405; `dialogs/typesetDocFormat.js` 778–787] |

Key template (L 999–1017):
```
<xsl:when test="$endnotes &gt; 0">\protect\endnote</xsl:when>
<xsl:when test="$markOrText='textOnly'">\protect\footnotetext</xsl:when>
<xsl:when test="$markOrText='markOnly'">\protect\footnotemark</xsl:when>
<xsl:otherwise><xsl:text>\protect\footnote</xsl:text></xsl:otherwise>
… <xsl:if test="$overrideNumber">[<value-of $overrideNumber/>]</xsl:if>
<xsl:if test="not($markOrText='markOnly')">{<xsl:apply-templates mode="inner"/>}</xsl:if>
```

Notes and pitfalls:
- **Hidden notes are still exported.** No XSL file tests `@hide`. **[V: grep of all of `filters/prnc2ltx`]**
- Footnote content is processed in `mode="inner"`. Only `bodyText` has an `inner` template; it joins paragraphs with `\par `. Any other direct child of a footnote (for example `bodyMath`, a list, `centered`) falls back to the XSLT built-in rules. Those rules copy text raw and drop all markup. **[I from L 616–624]**
- `<note>` is matched by two templates of equal priority: the theorem-environment union template (L 704) and the `\marginpar` template (L 1020). The later one wins, so `\marginpar`. **[I]**
- `\thanks`: L has `note[@type='footnote']` in `mode="frontmatter"` → `\thanks{…}` (L 475). Nothing ever applies `mode="frontmatter"` to note children, so this path is dead. A footnote inside `<author>` or `<title>` therefore exports as `\protect\footnote`. **[I]** AMS and RevTeX classes use a separate `<thanks>` element (§5).
- Importer mismatch: `\footnote[5]{…}` is imported as `<note type="footnote" footnoteNumber="5">`, with the attribute on the **note**. Export reads it from the **wrapper**, so the override number is lost when the file is round-tripped through SW6. **[V: XO `\footnotex`; L 996]**

---

## 2. Citations and bibliography

### 2.1 `<citation>` (inline)

```xml
<citation xmlns="http://www.w3.org/1999/xhtml" citekey="HB98a,Hirsh64" hasRemark="true" [type="bibtex"] [nocite="true"] [isStarred="true"]>
  <biblabel class="remark">p. 12</biblabel>
</citation>
```
| Attr / child | Meaning | Evidence |
|---|---|---|
| `@citekey` | One key or a comma-separated list (written unchanged into `{}`). | [V: TO 895–897; sample AMS shell] |
| `@hasRemark` | `"true"`/`"false"`. When true, the `biblabel` child gives the optional `[remark]`. | [V: L 925] |
| `@type` | `"bibtex"` for citations made by the BibTeX dialog. Manual citations have no `@type`. Export ignores it. | [V: TO 896] |
| `@nocite` | `"true"` gives `\nocite`. | [V: L 922; TO 899] |
| `@isStarred` | `"true"` gives `\cite*`. Only the importer sets it (from `\cite*`). | [V: L 923; XO `\citestar`] |
| `biblabel class="remark"` | The remark text. | [V: TO, XO] |

Output (L 920–925):
```
<xsl:when test="@nocite='true'">\nocite</xsl:when>
<xsl:when test="@isStarred='true'">\cite*</xsl:when>
<xsl:otherwise>\cite</xsl:otherwise>
<xsl:if test="@hasRemark='true'"><xsl:apply-templates select="html:biblabel"/></xsl:if>{<xsl:value-of select="@citekey"/>}
```
`biblabel` → `[text]`, written only when it is not empty, through the `optional` template. That template uses `value-of`, so **markup inside the remark is flattened to plain text and is not escaped**. **[V: L 96–107, 1387–1391]**

### 2.2 Manual bibliography (`thebibliography`)

```xml
<bibliography>
  <bibitem hasLabel="false"><bibkey>HB98a</bibkey>
    <bodyText>Harstad, K. …</bodyText></bibitem>
  <bibitem hasLabel="true"><biblabel class="bibitemlabel">[HB]</biblabel><bibkey>X</bibkey><bodyText>…</bodyText></bibitem>
</bibliography>
```
| Element | TD class / content | LaTeX | Evidence |
|---|---|---|---|
| `bibliography` | `listparenttag`, `htmllist ul`, contains `bibitem`. | `\begin{thebibliography}{99}` … `\end{thebibliography}`. The widest-label argument is always `99`. Nothing is written if the list is empty. | [V: L 1366–1371; TD] |
| `bibitem` | `listtag`, contains `biblabel`, `bibkey`, paragraphs. `@hasLabel` true/false (export ignores it). | `\bibitem` + children, with a blank line between items. | [V: L 1373–1379] |
| `bibkey` | text only | `{key}` (value-of, not escaped) | [V: L 1381–1385] |
| `biblabel class="bibitemlabel"` | optional label | `[label]` (flattened text) | [V: L 1387; TO 1036–1037] |

### 2.3 BibTeX

| Element | Attrs | LaTeX | Evidence |
|---|---|---|---|
| `bibtexbibliography` (inline, placed in body) | `databaseFile` (comma list of `.bib` names, no extension) and `styleFile` (`.bst` name) | `\bibliographystyle{styleFile}` newline `\bibliography{databaseFile}` | [V: L 931–933; TO 995] |

- `\nocite`: write `<citation nocite="true" citekey="…"/>` (§2.1). The Insert-Citation dialog option "bBibEntryOnly" sets this. **[V: TO 898–900]**
- Manual versus BibTeX mode for each document is stored as an XML comment: `<!--TCIDATA{BibliographyScheme=bibtex}-->` (or `=manual`). If it is missing, the preference `swp.bibchoice` is used. **[V: `msiEditor.js` 9896–9915; CC `createNewCommentNode` "comment-key-value"]** (exact placement of the comment in the document: **[I]** head)
- The importer turns `\bibliographystyle{s}\bibliography{d}` into `<bibtexbibliography databaseFile="d" styleFile="s">`. It turns `\cite[x]{k}` into `<citation citekey="k" hasRemark="true"><biblabel class="remark">x</biblabel></citation>`. **[V: XO 761–809, 941–951]**

---

## 3. Hyperlinks, cross-references, labels

| Element | Attributes | LaTeX | Evidence |
|---|---|---|---|
| `a` with `@href` | `href` (URL, `mailto:`, `#anchor`); optional `req="hyperref"` | `\href{URL}` newline `{text} ` (URL written raw with value-of; text escaped; a space follows). | [V: L 1269–1270; samples swwelcome] |
| `a` with `@name` (marker / hypertext target) | `name`, `key`, `id`, all equal to the label key | `\label{name}`. Because `a[@name]` has higher priority than `a`, an `<a>` that has both `name` and `href` loses its link. | [V: L 1322; `keyEntryOverlay.js saveKey`; XO `\@label`] |
| `marker` (legacy) | `id` | `\label{id}` | [V: L 1273] |
| `xref` | `key` (label), `href` (= key), `reftype` = `obj`\|`page`, optional `req="varioref"` | `\ref{key}`, `\pageref{key}`, `\vref{key}`, `\vpageref{key}` | [V: L 935–950; TO 1083–1094] |
| `url` | none | **No `url` element exists** in TD, CSS, or XSL. Use `a href`. AMS has `urladdr` (§5). | [V: grep] |

`xref` output (L 937–946):
```
<xsl:when test="@req='varioref'"> page→\vpageref{@key}  else→\vref{@key}
<xsl:otherwise>                    page→\pageref{@key}   else→\ref{@key}
```
- The `hyperref` package is **not** added automatically for `<a>`. It is loaded only if some element carries `req="hyperref"`, for example a link created that way, the Document Format "hyperref" checkbox (`<hyperref req="hyperref"/>` inside `docformat`), or DocInfo `<meta>`/`<link>` nodes. **[V: P package collection `//*[@req]`; `typesetDocFormat.js` 763–776; CC ~8050]**
- Other places where labels come from: equation `@key`/`@marker` (§9) and `imagecaption/@key` on frames (§11).

---

## 4. Index entries; glossary

```xml
<indexitem pri="Hilbert space" sec="separable" ter="" enc="textbf" specAppearance="p s">
  <prispec><italics>Hilbert</italics> space</prispec>
  <secspec>…</secspec>
</indexitem>
```
| Attr / child | Meaning / values | Evidence |
|---|---|---|
| `@pri`, `@sec`, `@ter` | Primary, secondary, and tertiary sort text. The dialog has already makeindex-escaped them: `"`→`""`, `|`→`"|`, `@`→`"@`, `!`→`"!`. | [V: `dialogs/indexentry.js` doEscapes 221–227] |
| `@enc` | Page format: `textbf`, `textit`, or `see{text}` (cross-reference). Left out for a plain page number. | [V: indexentry.js 305–321] |
| `@specAppearance` | Space-separated subset of `p s t`: which `*spec` children exist. Informational only; export ignores it. | [V: indexentry.js; LI] |
| `prispec`/`secspec`/`terspec` | Rich content (text tags, math, …) for the "appearance" part after `@`. | [V: TD; indexentry.js] |

LaTeX (L 957–985):
```
\index{ @pri [@ prispec] [! @sec [@ secspec]] [! @ter [@ terspec]] [| @enc] }
```
(`prispec` → `@` + content in default mode, so it is escaped. Empty `sec`/`ter` are skipped.)

- If any `indexitem` exists, the preamble gets `\usepackage{makeidx}` and `\makeindex` is written just before `\begin{document}`. **[V: P 237–240; L 395–398]**
- `\printindex` is written **only** for an explicit `<printindex/>` element. The automatic version is commented out. **[V: L 406–419, 1500]**
- TD defines a tag `indexentry` with children `prispec|secspec|terspec`, but documents use **`indexitem`**. `indexentry` has no export template. **[V: TD; L]**
- Glossary: TD has a hidden envtag `glossary`, but there is **no export template**, so its content is dropped. There is no make-glossary element. **[V]**

---

## 5. Front matter

Front-matter elements sit in the body as ordinary paragraphs, usually in the first `bodyText` or as siblings. The shell example is below. **[V: sample Standard_LaTeX_Book]**
```xml
<bodyText><frontmatter/>
<title>…</title><author>The Author<msibr type="newLine" invisDisplay="&amp;#x21b5;"/>His address</author>
<date>The Date</date>
<maketitle/><maketoc/><makelof/><makelot/></bodyText>
```

| Element | Attrs / children | LaTeX (base `latex.xsl`) | Evidence |
|---|---|---|---|
| `title` | optional `shortTitle` child; `@type="ours"` in TD initial content | `\title[short]{…}`. `[short]` is written whenever a `shortTitle` exists, even in classes whose `\title` takes no optional argument **[I]**. | [V: L 687–694, 697–702] |
| `author` | text, `msibr`. Several `author` elements are allowed. | The first author writes `\author{A1` + (`\\`+ next sibling `address` if it directly follows) + for each later author ` \and A2 …` + `}`. | [V: L 437–468] |
| `address` | text, `msibr` | In base `latex.xsl` it is **ignored on its own** (template is empty). It is written only when it directly follows an `author`. | [V: L 159, 442–446] |
| `date` | text | `\date{…}` | [V: L 518–520] |
| `abstract` | paragraphs (`bodyText`) | `\begin{abstract}`…`\end{abstract}` | [V: L 477–483] |
| `maketitle` | empty | `\maketitle` | [V: L 485–489] |
| `maketoc` | empty | `\tableofcontents ` | [V: L 503–506] |
| `makelof` / `makelot` | empty | `\listoffigures ` / `\listoftables ` | [V: L 508–516] |
| `frontmatter` / `mainmatter` / `backmatter` | empty | `\frontmatter` / `\mainmatter` / `\backmatter` | [V: L 1493–1498] |
| `msibr type="newLine"` inside author/date/title/abstract | — | `\\` (elsewhere `\newline `) | [V: SP 119–144] |
| `thanks` | text | **No template in `latex.xsl`, so dropped.** AMS: `\thanks{…}`. RevTeX: also defined. | [V: AMS] |

AMS classes (`amscls.xsl`, used by shells with `<?sw-xslt href="amscls.xsl"?>`; tag set from `prince/res/tagdefs/amsclsdefs.xml`):

| Element | Output | Evidence |
|---|---|---|
| `author` (each one) | `\author[authorid]{…}` when its first child is `<authorid>` | [V: AMS] |
| `address`, `curraddr`, `email`, `urladdr`, `contrib` | `\address[id]{…}`, `\curraddr[id]{…}`, `\email[id]{…}`, `\urladdr[id]{…}`, `\contrib[id]{…}`. The optional `[id]` comes from an `<authorid>` child. | [V: AMS; sample AMS_Journal_Article lines 50–59] |
| `thanks`, `translator`, `dedicatory`, `keywords` | `\thanks{}`, `\translator{}`, `\dedicatory{}`, `\keywords{}` | [V: AMS] |
| `subjclass` + `subjclassyear` child | `\subjclass[year]{…}` | [V: AMS] |
| `msibr` | ` \\` | [V: AMS] |

RevTeX (`revtex4-1.xsl`/`-2.xsl`) adds: `affiliation`, `altaffiliation`, `collaboration`, `noaffiliation`, `email`, `homepage`, `preprint`, `received`, `revised`, `accepted`, `published`, `pacs`, `keywords`, `volumeyear`, `volumenumber`, `issuenumber`, `eid`, `startpage`, `endpage`, `widetext` (env), `acknowledgments` (env), `firstname`, `surname`. **[V: template list grep]** Beamer adds `frametitle`, `framesubtitle`, `institute`, `subtitle`, `subject`, step lists, and others. **[V: beamer.xsl]**

---

## 6. Book structure, sectioning, numbering

```xml
<part><sectiontitle>…</sectiontitle>
  <chapter [nonum="true"] [subdoc="name" open="true|false"]>
    <sectiontitle><shortTitle>Short</shortTitle>Full title</sectiontitle>
    <bodyText>…</bodyText>
    <section>…</section>
  </chapter></part>
```

| Element | TD level | LaTeX | Evidence |
|---|---|---|---|
| `part` | -1 | `\part` | [V: TD; L 645–685] |
| `chapter` | 1 | `\chapter` | same |
| `section` | 2 | `\section` | same |
| `subsection` | 3 | `\subsection` | same |
| `subsubsection` | 4 | `\subsubsection` | same |
| `paragraph` | 5 | `\paragraph` | same |
| `subparagraph` | 6 | `\subparagraph` | same |
| `sectiontitle` | title of its parent | blank line + `\<parentname>` + `*` if `../@nonum='true'` + `[shortTitle]` + `{title}` + newline | [V: L 645–685] |
| `shortTitle` | inside `sectiontitle`, `title`, `imagecaption` | written as `[…]` (formatted content kept) | [V: L 697–702] |
| `appendix` | empty element, usually inside a `bodyText` | `\appendix` | [V: L 1499; sample Book] |

- Sections **nest**: a `section` contains its subsections. Section text is not a flat list of siblings. **[V: sample Book]**
- `@nonum="true"` → starred command. The structure dialog sets it. **[V: CC `doReviseStructureNode`; `dialogs/structureproperties.js`]** With both a short title and `nonum`, the output would be `\section*[short]{…}`, which is invalid LaTeX. **[I]**
- Math inside a `sectiontitle` gets `\protect` before fragile commands. **[V: M 40–50 `protecting`]**
- Numbering style element in the head (`P` `html:numberstyles`): attributes `part|chapter|section|subsection|subsubsection|paragraph|subparagraph` = a counter-style macro name such as `arabic` or `Roman`, or `none`. Output: `\renewcommand\thesection{\arabic{section}}` (or `{}` for `none`). Bugs in the source: the paragraph branch writes `\renewcommand\paragraph{\thesubbsusection.…` and the subparagraph branch redefines `\subparagraph`. **[V: P 675–753]**
- Equation sub-numbering ends at section/chapter/part/body boundaries (§9.3).

---

## 7. Inline text tags

All of these are `texttag` class in TD. They contain text, other text tags, inline math, `a`, `xref`, `citation`, `indexitem`, `msibr`, `texb`, and others. **[V: TD 33–55]**

| Element | LaTeX | Evidence |
|---|---|---|
| `bold` | `\textbf{…}` | [V: L 1123] |
| `italics` | `\textit{…}` | [V: L 1124] |
| `emphasized` | `\emph{…}` | [V: L 1137] |
| `roman` / `sansSerif` / `slanted` / `smallCaps` / `typewriter` | `\textrm` / `\textsf` / `\textsl` / `\textsc` / `\texttt` | [V: L 1127–1136] |
| `underline` | `\underline{…}` | [V: L 1157] |
| `upper` / `lower` | `\uppercase{…}` / `\lowercase{…}` | [V: L 1139–1142] |
| `sub` / `sup` | `\textsubscript{…}` / `\textsuperscript{…}` | [V: L 1159–1162] |
| `tiny` `scriptsize` `footnotesize` `small` `normalsize` `large` `Large` `LARGE` `huge` `Huge` | `{\size …}` | [V: L 1145–1154, 1206–1215] |
| `phantom` | `\phantom{…}` | [V: L 1155] |
| `smallbox` | `\fbox{…}` (the importer turns `\fbox` and `\frame` into `smallbox`) | [V: L 1125; XO] |
| `ltxframe` | `\frame{…}` | [V: L 1238] |
| `fontcolor color="#rrggbb"` or a named color | `\textcolor[HTML]{RRGGBB}{…}` or `\textcolor{name}{…}` | [V: L 1227–1232] |
| `fontsize size="10/12 pt"` | `\fontsize{10pt}{12pt}\selectfont{ …}`. The format is `size/leading unit`. The size change continues past the closing brace. If the size is 0, the output has an unmatched `}`. **[I bugs]** | [V: L 1216–1225] |
| `otfont fontname="X"` | `{\fontspec{X}…}` (XeLaTeX) | [V: L 1234] |
| `alt` | `{\addfontfeatures{RawFeature=+salt}…}` | [V: L 1122] |
| `drop` | `\lettrine[lhang=.2]{\textbf{…}}{}` (lettrine package is not added automatically) | [V: L 827–829] |
| `texlogo name=…` | `tex`→`\TeX{}`, `latex`→`\LaTeX{}`, `pdftex`, `pdflatex`, `xetex`, `xelatex`, `amstex`, `amslatex`. Children `L<sup>A</sup>T<sub>E</sub>X` are for display only. **`name="bibtex"` (made by the importer) writes nothing.** | [V: L 202–211; XO `\BibTeX`] |
| `verb` / `verbstar` | `\verb|…| ` / `\verb*|…|`. The delimiter is always `|`, so the output breaks if the content contains `|`. Text is raw. | [V: L 1052–1062] |
| `rawTeX tex="\cmd" [post="…"]` | `@tex` + `{` (added only if `@tex` has no unmatched `{`) + content + `}`, or `@tex` content `@post` | [V: L 1502–1513] |
| `uline` `uuline` `uwave` `sout` `xout` `dashuline` `dotuline` (ulem) | `\uline{…}` etc. TD has them commented out. | [V: L 1539–1565] |
| `textXXX` (Babel inline, e.g. `textfrench`) | `\textfrench{…}`; ~100 languages | [V: `babel.xsl`] |
| `texthebrew` | `\texthebrew{…} ` | [V: L 1143] |
| `tex`, `textquotedblleft`, `textquotedblright`, `textbackslash` | `\TeX{}`, `\textquotedblleft `, … | [V: L 1240–1247] |
| `nbspace` | `~` | [V: SP 32] |
| `hspace type=…` | `requiredSpace`→`\ `, `emSpace`→`\quad `, `twoEmSpace`→`\qquad `, `thinSpace`→`\thinspace `, `medSpace`→`\medspace `, `thickSpace`→`\thickspace `, `negativeThinSpace`→`\negthinspace `, `italicCorrectionSpace`→`\/`, `zeroSpace`→`{}`, `noIndent`→`\noindent `, `customSpace dim=… atEnd=true`→`\hspace*{dim}`, `class="stretchySpace" flex=N fillWith=dots\|line`→`\dotfill`/`\hrulefill`/`\hspace{\stretch{N}}` | [V: SP 36–59] |
| `vspace type=…` | `smallSkip`/`mediumSkip`/`bigSkip`/`strut`/`mathStrut`/`customSpace dim atEnd` | [V: SP 88–98] |
| `msirule lift width height [color]` | `\rule[lift]{w}{h}`, colored version via `\textcolor[HTML]` | [V: SP 100–117] |
| `msibr type=…` | `allowBreak`→`\allowbreak `, `pageBreak`→`\par\pagebreak\relax `, `newPage`→`\newpage `, `discretionaryHyphen`→`\-`, `lineBreak`→`\linebreak\relax `, `noBreak`→`\nolinebreak\relax `, `newLine`→`\newline ` (`\\` in front matter), `customNewLine dim`→` \\[dim]`, other → `\\` | [V: SP 119–144] |
| `br hard="1"` | ` \\` | [V: L 421] |
| `br` | newline. SW6 also writes `<br type="_moz"/>` as a cursor placeholder in empty blocks. | [V: L 429] |
| `QTR type=X` (SW 5.5 legacy) | `\QTR{X}{…}`. ulem and beamer variants exist (`QQQuline`, `frametitle`, …). | [V: L 1303, 1519–1575] |

Tags in TD with **no export template, so the content is dropped**: `rtl`, `boldsymbol`, `blackboardBold`, `calligraphic`, `fraktur` (these four are math-only. In math they become `mathvariant` on `mi`; see §9.5). Importer-made `upright` (`\textup`) and `medium` (`\textmd`) also have no template. **[V: script cross-check of TD names vs all `match=` patterns]**

---

## 8. Paragraph tags, environments, lists, theorems

### 8.1 Paragraphs

| Element | TD class | LaTeX | Evidence |
|---|---|---|---|
| `bodyText` (default paragraph) | paratag | content, then a blank line unless it is the last sibling | [V: L 582–596] |
| `rtlBodyText` | paratag | `\begin{RTL}…\end{RTL}` | [V: L 598–614] |
| `p` (HTML paragraph) | paratag | `\par ` + content | [V: L 1119] |
| `bodyMath` | paratag | content + `\par ` (except the last one) | [V: L 635–641] |
| `centered` | paratag | `\begin{center}…\end{center}\par` | [V: L 1084–1086] |
| `flushleft` / `flushright` | paratag | `\begin{flushleft}…\end{flushleft}\par`, same for flushright | [V: L 1088–1094] |
| `shortQuote` | paratag (holds `bodyText` children in shells) | `\begin{quote}…\end{quote}` | [V: L 1064–1068; sample] |
| `longQuotation` | envtag | `\begin{quotation}…\end{quotation}` | [V: L 1071–1076] |
| `centeredEnv` | envtag | `\begin{center}…\end{center}\par` | [V: L 1078–1082] |
| `verbatim` | paratag. Holds raw text and `<br/>` line breaks (the importer writes a `bodyText` inside it). | `\begin{verbatim}` + text in verb mode (raw; `br`→newline) + `\end{verbatim}` | [V: L 1045–1050; sample Book] |
| `pre` | — | `\begin{verbatim}` newline + `string(.)` + `\end{verbatim}` | [V: L 1096–1100] |
| `environment type=X [param=Y]` | generic | `\begin{X}{Y}[leadin]…\end{X}` | [V: L 780–797] |
| `Note`, `GrayBox`, `epigraph` | legacy | `\begin{Note}` etc. | [V: L 1280–1300] |
| Language envs (`french`, `english`, `USenglish`, …) | envtag | `\begin{french}…\end{french}` | [V: babel.xsl] |
| `QTP type=X` | legacy 5.5 | `\QTP{X}` … `\par`; `type="Body Math"` passes through | [V: L 1307–1315] |

There is **no `verse` tag** in TD and no template for it. **[V]** `dedication` and `preface` are hidden TD envtags with no template, so their content is dropped. **[V]**

### 8.2 Lists

```xml
<numberedlist>
  <numberedListItem><bodyText>Item 1</bodyText></numberedListItem>
  <numberedListItem><numberedLabel>(a)</numberedLabel><bodyText>…</bodyText>
    <numberedlist>…nested…</numberedlist></numberedListItem>
</numberedlist>
<descriptionlist><descriptionListItem><bodyText><descriptionLabel>Term</descriptionLabel>Text</bodyText></descriptionListItem></descriptionlist>
```
| Element | LaTeX | Evidence |
|---|---|---|
| `numberedlist` / `bulletlist` / `descriptionlist` | `\begin{enumerate}` / `itemize` / `description` … `\end{…}`. Written only if the list has element children. | [V: L 832–859] |
| `numberedListItem` / `bulletListItem` / `descriptionListItem` | `\item ` + children; blank line between items | [V: L 862–913] |
| `numberedLabel` | `[label]` (formatted; wrapped in `{…}` if the label contains `]`) | [V: L 874–893] |
| `bulletLabel`, `descriptionLabel`, `explicit-item` | `[label]` via `optional`, so **flattened to plain text** | [V: L 903–918, 1264] |

- Nesting: a child list goes **inside** the item, after its `bodyText`. Shells go up to 4 levels. **[V: sample Book]**
- `descriptionLabel` sits **inside** the item's first `bodyText`. **[V: TD initial content; sample]**
- No list attributes (start, style) are read by export. **[V]**

### 8.3 Theorem-like environments

Elements (TD envtags, all `contains envLeadIn`): `theorem acknowledgment algorithm assertion assumption axiom case claim conclusion condition conjecture corollary criterion definition example exercise hypothesis lemma notation texnote problem property proposition question remark solution summary proof`. Export also accepts `acknowledgement` and `generictheorem`. **[V: TD; L 249, 704]**

```xml
<theorem [numbering="none|<countername>"] [leadInType="custom"]>
  <envLeadIn><bodyText>Main Theorem</bodyText></envLeadIn>
  <bodyText>…</bodyText>
</theorem>
```
| Attr / child | Meaning | Evidence |
|---|---|---|
| `@numbering` | `none` = unnumbered; otherwise the name of a counter it shares. | [V: `dialogs/thmproperties.js` 68–82] |
| `@leadInType="custom"` + `envLeadIn` | Custom lead-in text, written as the optional argument. | [V: `dialogs/envproperties.js`; XO `\msi@envWithLeadin`] |

LaTeX: `\begin{NAME}` + `[leadin]` + newline + content + `\end{NAME}` + blank line. **[V: L 751–778]**
- `proof` → `\begin{proof}` newline `[leadin]` … `\end{proof}`. **[V: L 800–809]**
- `texnote` → `\begin{note}`…`\end{note}`. TD uses `texnote` for the theorem-style Note because `note` is already taken by footnotes and margin notes. **[V: L 811–821; LD `\MSISimpleEnvironment[texnote]{note}`]**
- **No `\newtheorem` is generated.** The calls to `generateMissingNewTheorems` and `writeNewTheoremList` are commented out. The `\newtheorem` lines must already be in `<preambleTeX>` (every shell has them). `<newtheorem name label counter theoremstyle>` head elements are only used to map element names to TeX names. **[V: P 288–289; L 223–246, 310–311; sample shells]**
- `numbering="none"`: the XSL tries to produce `NAME*`. Tracing the variables, the "needed theorems" list always contains the tag, so the lookup returns the plain name and **the star is never added**. **[I from L 248–276, 726–769]**

---

## 9. Math

Math is MathML 2 in the namespace `http://www.w3.org/1998/Math/MathML`. In shells it is written as `<math xmlns="…MathML">` with unprefixed children. **[V: sample]**

### 9.1 Inline and display without `msidisplay`

| Form | LaTeX | Evidence |
|---|---|---|
| `<math>` (no `display`) or `display="inline"` | `$…$` | [V: M 383–404] |
| `<math display="block">` not inside `msidisplay` | `\[ … \]`. A single framed one-row mtable gives `\fbox`/`\frame`; a 1-column labeled table gives `equation`; a 1-column multi-row table gives align/gather via `EQ`. | [V: M 250–380] |
| `@mode="display"` (deprecated) | treated like `display="block"` | [V: M] |

### 9.2 `msidisplay` (numbered displays)

```xml
<msidisplay [numbering="none|eqns"] [marker="eqn1"] [key="eqn1"] [id="eqn1"]
            [customLabel="*"] [suppressAnnotation="true"]
            [subEquationNumbers="true"] [subEquationContinuation="true"] [subEquationReset="true"]>
  <math display="block">…</math>
</msidisplay>
```
`msidisplay` is TD `othertag`, inline inside a paragraph, and holds exactly one `math`. Export applies templates to **`math/*`**, which skips the `$`/`\[` wrapper. **[V: TD; L 1393–1491]**

Single-line display (no `mtable[@type='eqnarray']` inside):
```
\begin{equation[*]} <math children> [\tag[*]{customLabel}] [ \label{key or marker}]
\end{equation[*]}
```
`*` is added when `@numbering='none'`. `\tag*` is used when `@suppressAnnotation='true'`. `@key` wins over `@marker`. A `key` on an inner `mrow` (seen in shells) is ignored here. **[V: L 1455–1489; sample Book `<mrow key="eqn1">`]**

### 9.3 Multi-line (`mtable type="eqnarray"`)

Pressing Enter in a display creates `<mtable type="eqnarray">` and sets `msidisplay numbering="eqns"`. **[V: `editor/libeditor/msi/msiEditor.cpp` 4393–4412]**

| Where | Attr | Values / meaning | Evidence |
|---|---|---|---|
| `mtable` | `type` | `eqnarray` | [V: msiEditor.cpp] |
| `mtable` | `alignment` | `alignStandard` \| `alignSingleEqn` \| `alignCentered` | [V: `dialogs/equationArrayDialog.js` 13, 243–250] |
| `mtable` | `subtype` | an explicit LaTeX environment name to use when there are no align points | [V: EQ 171–173] |
| `mtable` | `rowspacing` | space-separated per-row extra space. Only `1.500000ex`/`2.000000ex`/`3.000000ex` map to `\smallskip`/`\medskip`/`\bigskip`. | [V: EQ 49–70; mathmlOverlay.js 2797] |
| `mtr` | `numbering` | `none` → `\nonumber` | [V: mathmlOverlay.js 2787–2789; EQ 466–488] |
| `mtr` | `customLabel`, `suppressAnnotation` | `\tag{…}` / `\tag*{…}` | [V: EQ 450–465] |
| `mtr` | `marker`, `id`, `key` | `\label{…}`. Order: first-cell `mrow/@id`, then `@key`, then `@marker`. | [V: EQ 378–394] |
| `mtd` children | `maligngroup` | each one becomes ` & ` | [V: EQ 331–353] |

Environment choice (EQ 156–282). `n-aligns` = number of `maligngroup` in the first row's cells:
- 0 aligns: `alignCentered`→`gather`, `alignSingleEqn`→`multline`, else `@subtype`, else `align` (for `type="eqnarray"`), else `gather`.
- More than 0: `alignCentered`→`gather`, otherwise `align`. (The `alignat{2}` branch for 4 aligns cannot be reached, because the `>0` test comes first.) **[I]**
- Starred (`*`) when no row is numbered, or when `msidisplay/@numbering='none'`.
- **Bug**: when the alignment point is detected automatically (a row has no `maligngroup`), the XSL writes ` & 5` and ` & 6`. These are leftover debug digits that end up in the TeX. **[V: EQ 356, 359]**

Sub-equation numbering: `subEquationNumbers="true"` opens `\begin{subequations}`. A later display with `subEquationContinuation="true"` continues it; otherwise `\end{subequations}` is written. A section, chapter, part, or body end also closes it. For `article`, the container list includes `section`; other classes only use chapter/part/body. **[V: L 366–391, 1393–1410]** `subEquationReset` is maintained by the editor; export does not read it. **[V: msiEditorUtilities.js 7940–7972]**

### 9.4 Other display and table forms (`M` `mml:mtable`)

| mtable form | LaTeX | Evidence |
|---|---|---|
| `@flv="cases"` / `"rcases"` | `\begin{cases}` / `rcases` | [V: M 1106–1257] |
| `@flv="X"` (other non-empty matrix flavor) | `\begin{Xmatrix*}` (mathtools), e.g. `pmatrix*` **[I for the exact values; the C++ `CreateMtable` writes `flv`]** | [V: M; msiUtils.cpp 1729] |
| 1-column, auto-detected | `gathered` / `aligned` / `split` / `array` | [V: M] |
| `@frame` / `@rowlines` / `@columnlines` set | `tabular` (via `MML2tabular.xsl`) | [V: M] |
| one row, `frame="solid"` | `\fbox{}` if `framespacing="0.8em 1.0ex"`, else `\frame{}` | [V: M] |
| `rowspacing=0 columnspacing=0` inside a script | `\substack` | [V: M] |
| Other `mtable` attrs written by the editor | `rowSignature`, `baseline` | [V: msiUtils.cpp 1728–1733] |

### 9.5 Math names, operators, units, fonts, spaces

| Construct | Storage | LaTeX | Evidence |
|---|---|---|---|
| Function name | `<mi msimathname="true" val="sin" type="function">sin</mi>`; optional `msiclass="enginefunction"` | Known names (`sin cos tan … lim max min sup inf det gcd log ln exp Pr arg deg dim hom ker lg …`) → `\sin ` etc. Anything else → `\ensuremath{\operatorname*{…}}` | [V: L 1163–1199; mathmlOverlay.js 2506–2549] |
| Operator name | `<mo msimathname="true" type="operator" movablelimits="true|false" [msiLimitPlacement="msiLimitsAtRight|msiLimitsAboveBelow|auto"] [size]>` | same mapping (in `mo.xsl`). `msiLimitPlacement` is **not read** by export. | [V: mo.xsl 28–66; mathmlOverlay.js] |
| Unit | `<mi msiunit="true">kg</mi>` (unit list in `prince/res/xml/unitnames.xml`) | `\mbox{kg}` | [V: L 1200–1202; msiUtils.cpp 1319–1335] |
| `mathvariant` | `bold` `italic` `normal` `sans-serif` `monospace` `script` `fraktur` `double-struck` `bold-italic` `sans-serif-italic` | `\mathbf` `\mathit` `\mathrm` `\mathsf` `\mathtt` `\mathcal` `\mathfrak` `\mathbb` `\boldsymbol` `\mathsfit` | [V: mi.xsl 440–506] |
| `mspace type=…` | same names as text `hspace`, plus `width` values (`thinmathspace`→`\,` …, `linebreak="goodbreak"`→`\allowbreak`) | | [V: M 452–558] |
| `menclose notation="box" type="fbox|frame"` | `\fbox{}` / `\frame{}` | | [V: M 83–107] |
| Fence bound markers | `mo msiBoundFence="true"`, `mo flv` | editor bookkeeping | [V: msiEditorUtilities.js 8414, 8611] |

The math-only text tags `blackboardBold`, `calligraphic`, `fraktur`, and `boldsymbol` map to `mathvariant` (`double-struck`, `script`, `fraktur`, bold) through TD `<mathvar>`. **[V: TD 63–100; sample Book]**

---

## 10. Subdocuments, TeX fields, and other body elements

### 10.1 Subdocuments

- Any structure tag (part…subparagraph) can have `subdoc="name"` and `open="true|false"`. **[V: CC `doReviseStructureNode`; `bindings/latex.xml` "collapsible"]**
- When collapsed (`open="false"`), everything after the `sectiontitle` is serialized to `<name>.xml` in the document's working directory, next to `main.xhtml`, and **removed from the main DOM**. Expanding reads the file back and deletes it. **[V: `bindings/latex.xml` saveToDisk/getFromDisk 1499–1570]**
- Export has no subdoc logic, so closed subdocuments are **missing from the TeX**. `openAllSubdocs()` exists, but it is only wired to a menu item, not to export. **[V: L; code search; I for the effect]**
- SW 5.5 import: `\QSubDoc{name}{content}` keeps the content inline. A 5.5 child file with `%TCIDATA{LaTeXparent=…,master.tex}` opens its master instead. **[V: `ptdata/msi-tcilatex.tex` 543; PJ 372–385]**

### 10.2 TeX fields (`texb`)

```xml
<texb xmlns="http://www.w3.org/1999/xhtml" enc="1" name="vskip" [pre="0|1"] [pri="N"] [req="pkg"] [opt="…"]><![CDATA[\vskip 1in]]></texb>
```
| Attr | Meaning | LaTeX | Evidence |
|---|---|---|---|
| (none / `enc` not 1) | raw TeX | content copied raw | [V: L 1324–1364] |
| `enc="1"` | encapsulated "TeX button" | `%TCIMACRO{\TeXButton{name}{…commented…}}%` / `%BeginExpansion` / raw / `%EndExpansion` | same |
| `pre="1"` | belongs in the preamble | skipped in the body; written raw into the preamble, sorted by `@pri` | [V: P 85–90, 302–308] |
| `req`/`opt`/`pri` | package needed | added to `\usepackage` list | [V: P] |

### 10.3 Other body elements

| Element | Notes | Evidence |
|---|---|---|
| `msiframe`, `object`, `img`, `table` | §11; tables via `table.xsl` | [V: FR, GR] |
| `img` (HTML) | **no template, so dropped**. SW6 uses `object` inside `msiframe frametype="image"`. | [V: script check] |
| `button class="msi" minpasses="N"` | sets the LaTeX pass count; no output | [V: PJ 742–752; fragment `minpasses.frg`] |
| `printindex` | `\printindex` | [V: L 1500] |
| `htmlfield name=…` (importer `\HTMLButton`) | no export template | [V] |
| `requestimplementation` | `[ NEED TO IMPLEMENT: \verb+…+]` | [V: L 1277] |
| `cursor`, `plot`, `graphSpec`, `sw-meta`, `usepackage`, `documentclass` | written as nothing | [V: L 156–161, 1515] |
| Importer-only names with no template: `tabbing`, `tab-gt`, `tab-plus`, `boxedverbatim`, `leftquote`, `rightquote`, `asterisk`, `qedhere`, `nobreakspace`, `textcurrency`, `theoremstyle`, `newPageRule`, `cline`/`hline` | dropped on export (or wrapped by a parent template) | [V: grep] |

---

## 11. Frames, images, and plots

### 11.1 `msiframe` (images, floating tables, text frames)

Example from a shell: **[V: sample Book]**
```xml
<msiframe frametype="table" units="in" pos="floating" [ltxfloat="htbp"] width="2.73" height="1.28"
   sidemargin="0.1" topmargin="0.1" overhang="0.1" borderw="0" padding="0.1"
   border-color="#000000" background-color="#ffffff" captionloc="bottom" [rotation="rot90"] [nlines] req="wrapfig" style="…">
  <table …>…</table>
  <imagecaption align="bottom" key="TableKey"><bodyText>Caption</bodyText></imagecaption>
</msiframe>
```
| Attr | Values | Effect | Evidence |
|---|---|---|---|
| `frametype` | `image` \| `table` \| `textframe` \| none | `table`→`table`/`wraptable`; `textframe`→`minipage`; otherwise `figure`/`wrapfigure` | [V: FR] |
| `pos` | `inline`, `center`, `display(ed)`/`d`, `floating`, `left`/`right`/`inside`/`outside`, `L`/`R`/`I`/`O` | inline; `\begin{center}`; float + `\centering`; `wrapfigure{L|R|I|O|l|r|i|o}` | [V: FR 29–41, 160–185] |
| `ltxfloat` | placement string | `\begin{figure}[htbp]`; also makes the frame floating | [V: FR] |
| `width`/`height`/`units` (`ltx_width`/`imageHeight` legacy) | numbers + unit (`px` treated as `pt`) | sizes | [V: FR, GR `unit`] |
| `borderw`, `padding`, `border-color`, `background-color` | | always written as `\setlength\fboxrule{…}\fcolorbox[HTML]{BORDER}{BG}{…}` | [V: FR 230–270] |
| `rotation` | `rot0`/`rot90`/`rot270` | `\begin{turn}{-90}` / `{90}` | [V: FR] |
| `inlineOffset` | number | `\raisebox{-off}{…}` | [V: FR] |
| `captionloc` / `imagecaption/@align` | `top`/`bottom` | `\caption[short]{…}` for floats and wraps; otherwise `\ \\`+text | [V: FR 5–27] |
| label | the first child with `@key` (normally `imagecaption key=`) | `\label{key}` after the caption, **only for floating/wrapped frames that have a caption** | [V: FR] |

Image object: **[V: sample swwelcome]**
```xml
<msiframe frametype="image" units="in" pos="inline|center" width="3" height="0.75" …>
  <object data="graphics/logo.png" src="graphics/logo.png" req="graphics" naturalWidth naturalHeight
          originalSrcUrl copiedSrcUrl ltx_width ltx_height msi_resize="true" aspect="false" [typesetSource] [isVideo="true"]/>
</msiframe>
```
Output: `\includegraphics[ width=Win, height=Hin,]{logo}`. The size comes from the parent frame. The prefixes `graphics/`, `gcache/`, `tcache/` and the extension are removed; `@typesetSource` wins over `@src`/`@data`. The preamble always writes `\graphicspath{{../graphics/}{../tcache/}{../gcache/}}` and `\DeclareGraphicsExtensions{.pdf,.eps,.ps,.png,.jpg,.jpeg}`. `isVideo="true"` gives `\includemovie`. **[V: GR 22–60, 196–275; P 293–297]** Converted copies go into `gcache/` (screen PNG) and `tcache/` (TeX PDF). **[V: `prince/modules/graphicsConverter.jsm` ~800–1025]**

### 11.2 Plots

Structure, assembled from `GraphOverlay.js createGraphDOMElement` and `vcamoverlay.js insertSnapshot`: **[V]**
```xml
<graph>
  <graphSpec Key Name CaptionPlace ImageFile="plots/plot3.xvz" Width Height Units AxesType EqualScaling
             EnableTicks XTickCount … Dimension AxisScale Camera…/ViewingBox… Animate… AxisFont…/TicksFont… errStr userSetAttrs>
    <plot PlotStatus PlotType LineStyle LineThickness LineColor DiscAdjust DirectionalShading BaseColor SecondaryColor
          PointStyle SurfaceStyle SurfaceMesh AISubIntervals AIMethod AIInfo FillPattern Animate AnimCommonOrCustomSettings
          AnimateStart AnimateEnd AnimateFPS AnimateVisBefore AnimateVisAfter ConfHorizontalPts ConfVerticalPts DefaultedVars userSetAttrs>
      <Expression><math>…</math></Expression>   <!-- also XMin XMax YMin YMax ZMin ZMax AnimMin AnimMax XVar YVar ZVar AnimVar XPts YPts ZPts TubeRadius TubeRadialPts, each wrapping MathML -->
    </plot>
    <plotLabel …/>
  </graphSpec>
  <msiframe [captionloc] width height sidemargin topmargin … [req="wrapfig"]>
    <imagecaption>…</imagecaption>
    <object data="plots/plot3.xvz" msigraph="true" alt="Generated Plot" id="plot3"/>          <!-- live VCam (MuPAD) file: .xvz gzip / .xvc xml -->
    <object data="graphics/plot3.png" msisnap="true" width="3in" naturalWidth units id="ssplot3"/>  <!-- PNG snapshot -->
  </msiframe>
</graph>
```
Lists of attributes: [V: GraphOverlay.js 39–47 (COMPATTRIBUTES, GRAPHATTRIBUTES), 992–1002 (PLOTATTRIBUTES/PLOTELEMENTS)].

Export path:
1. Before exporting TeX, `rebuildSnapshots(doc)` re-renders a PNG snapshot into `graphics/` for every `graph/msiframe`. **[V: PJ `exportTeX`; vcamoverlay.js 753–770]**
2. `graph` → children; `graphSpec`/`plot` → nothing. **[V: FR 2; L 160, 1515]**
3. The plot frame has no `frametype` **[I: none is set in GraphOverlay.js]**. So its children are processed normally, and `object` is written only if `@msisnap or not(@msigraph='true')`. The result is that only the snapshot becomes `\includegraphics{plot3}`. **[V: GR `html:object` template]**

Plot files live in `plots/`. The `.sci` zip also holds `graphics/`, `gcache/`, `tcache/`, and `css/`. **[V: PJ 560–565, 767; sample zips]**

---

## 12. Head and preamble

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet href="css/my.css" type="text/css"?>
<?sw-tagdefs href="resource://app/res/tagdefs/latexdefs.xml" type="text/xml" ?>
<?sw-tagdefs href="resource://app/res/tagdefs/amsclsdefs.xml" type="text/xml" ?>   (optional, more than one allowed)
<?sw-xslt href="amscls.xsl" type="text/xml" ?>                                       (optional)
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1 plus MathML 2.0//EN" "http://www.w3.org/Math/DTD/mathml2/xhtml-math11-f.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:mml="http://www.w3.org/1998/Math/MathML">
<head><sw-meta id="sw-meta" product="Scientific WorkPlace" version="2020090317" created="…" lastrevised="…"/>
<preamble hide="true">
  <documentclass class="book" [options="…"]/>
  <requirespackage req="amsfonts" pri="010"/>  <usepackage req="x" opt="…" pri="…" [requirepackage="true"]/>
  <preambleTeX [id="1"]><![CDATA[\newtheorem{theorem}{Theorem}[chapter] …]]></preambleTeX>
  <newtheorem name="lemma" counter="theorem" label="Lemma" [theoremstyle="plain|definition|remark"]/>
  <docformat> <texprogram prog="xelatex" formatOK fontsOK pageFormatOK secFormatOK useUni useOTF req="fontspec"/>
     <colist textsize="11pt" papersize="a4paper" …/> <endnotes val="end" req="endnotes"/> <showkeys req=…/> <showidx/> <hyperref req="hyperref"/>
     <leading val="14pt" req="leading"/> <setspacing req="setspace" opt="onehalfspacing"/>
     <pagelayout latex="true" unit="in"><page paper twoside landscape width height/><textregion width height/>
        <margin left top/><hedd height sep/><columns count sep/><marginnote hidden width sep/><footer/></pagelayout>
     <crop type paper width height unit/> <fontchoices><mainfont ot="1" name options/><sansfont/><fixedfont/><x1font internalname/></fontchoices>
  </docformat>
  <babel pkg="babel|polyglossia" lang1 lang2 lang3/>  <numberstyles section="arabic" …/>  <sectitleformat level enabled …/>
</preamble></head>
<body showexpanders="true" showshort="true" [hideFootnotes] [hideOtherNotes] [hidemarkers] [hideindexentries] [hideInputBoxes] [hideHelperLines] [showinvis] [showfmbuttons]>
```
[V: samples; `typesetDocFormat.js` 760–940, 2918–2948; TO 640–700; P]

Export order (L `html:head`, P `html:preamble`, L `html:body`):
1. `%% Produced by …`, `%% Version …`, `%% Created …`, `%% Last revised …` from `sw-meta`.
2. `\begin{filecontents}…` (from `filecontents`, if present).
3. `\documentclass[…colist attr values…]{class}`. Every `colist` attribute value is used except the attribute `enabled` and the value `port`. **`documentclass/@options` (written by the importer) is ignored by export.** **[V: L 178–195]**
4. `%% preamble`, then `\usepackage{amssymb,amsmath,mathtools,xcolor,graphicx,xspace,colortbl,ragged2e,rotating}`. This line is always written. **[V: P 209]**
5. Non-pdflatex: `\usepackage{xltxtra,xkeyval}` and `\defaultfontfeatures{…}`. pdflatex: `\usepackage{textcomp}`.
6. `\usepackage{makeidx}` if there are index items.
7. Every `//*[@req]` anywhere in the document (`req`/`opt`/`pri` can be `;`-separated lists). Duplicates are removed, then sorted by priority. Defaults: amsfonts/amsmath 010, tcibkpk 080, wrapfig 100, xcolor/minipage 200, babel/polyglossia 1000, varioref 1001, hyperref 10000, bidi 10001, otherwise 100. `varioref` is skipped when `babel` exists. Each line is `\usepackage[opt]{pkg}  %% pri`. **[V: P 29–182, 245–285]**
8. `\graphicspath{…}` and `\DeclareGraphicsExtensions{…}`.
9. Children of `preamble` in document order: `preambleTeX` (raw), `babel` (`\usepackage[langs]{babel}` or polyglossia + `\setdefaultlanguage`), `docformat` children (`pagelayout[@latex='true']`→`\usepackage[…]{geometry}` only if `texprogram/@pageFormatOK='true'`; `crop`→`crop` package; fonts only for non-pdflatex with `fontsOK`; `leading`→`\leading{}` with `formatOK`), `numberstyles`, `sectitleformat` (titlesec), `meta`→`\hypersetup`/`\special` PDF info.
10. `texb[@pre='1']` contents.
11. `\makeindex` (if index items), then `\begin{document}` … `\theendnotes` (endnotes) … `\end{document}`.

`newtheorem`, `requirespackage`, `usepackage`, `texprogram`, `colist`, and `endnotes` write nothing themselves. **[V]**

---

## 13. Summary: elements that silently lose content on export

Because of the empty `*` template (§0.1), these lose their content: `rtl`, `boldsymbol`/`blackboardBold`/`calligraphic`/`fraktur` (when used as text tags), `dedication`, `preface`, `glossary`, `thanks` (non-AMS/RevTeX), `address` not right after an `author` (base class), `img`, `upright`, `medium`, `htmlfield`, `tabbing`, `boxedverbatim`, `indexentry`, collapsed subdocument bodies, `texlogo name="bibtex"`. **[V for missing templates; I for which ones occur in real files]**

Other export defects worth knowing for compatibility: `numbering="none"` theorems not starred (§8.3), `& 5`/`& 6` digits in auto-aligned arrays (§9.3), `\fontsize` leak (§7), the importer's `footnoteNumber` placement (§1.2), hidden notes exported (§1.2).

---

## 14. Source files used

XSL and tag definitions:
- `filters/prnc2ltx/latex.xsl`, `preamble.xsl`, `spaces.xsl`, `frame.xsl`, `graphics.xsl`, `texescape.xsl`, `babel.xsl`, `MML2LTeX.xsl`, `MML2eqna.xsl`, `mi.xsl`, `mo.xsl`, `amscls.xsl`, `revtex4-1.xsl`, `revtex4-2.xsl`, `beamer.xsl`, `packages.xml`
- `prince/res/tagdefs/latexdefs.xml`, `amsclsdefs.xml`
- `prince/res/css/baselatex.css`, `latex.css`, `latex_internal.css`
- `prince/res/xml/unitnames.xml`, `mathnames.xml`

LaTeX importer:
- `filters/ptprince/ptprince.xsl`
- `filters/ptprince/ptdata/msi-xmlout.tex`, `msi-latex-default.tex`, `msi-latexin.tex`, `msi-tcilatex.tex`

JavaScript and C++:
- `prince/base/content/prince.js`, `typesetOverlay.js`, `msiComposerCommands.js`, `msiEditor.js`, `msiEditorUtilities.js`, `mathmlOverlay.js`, `GraphOverlay.js`, `vcamoverlay.js`, `keyEntryOverlay.js`, `bindings/latex.xml`
- `prince/base/content/dialogs/Note.js`, `Note.xul`, `NoteOptionsDialog.js`, `indexentry.js`, `marker.js`, `xref.js`, `EdLinkProps.js`, `thmproperties.js`, `envproperties.js`, `structureproperties.js`, `equationArrayDialog.js`, `typesetDocFormat.js`, `typesetBib*.js`, `typesetManualCitation.js`
- `prince/modules/graphicsConverter.jsm`
- `editor/msiediting/src/msiUtils.cpp`, `editor/libeditor/msi/msiEditor.cpp`, `editor/libeditor/html/nsHTMLEditor.cpp`

Samples (unzipped `.sci`):
- `prince/shells/-Standard_LaTeX/Standard_LaTeX_Book.sci`, `Standard_LaTeX_Article.sci`
- `prince/shells/Articles/AMS_Journal_Article.sci`
- `prince/samples/swwelcome.sci`, `swpwelcome.sci`, `test-eqn-numbers.sci`
- fragments `prince/res/fragments/LaTeXhelpers/{CaptionHelper,MakeTableOfContents,minpasses}.frg`, `listFile.frg`
