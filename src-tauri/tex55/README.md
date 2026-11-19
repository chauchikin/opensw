LaTeX macro files for Scientific Word 5.x documents. Such documents load
tcilatex.tex and a Scientific Word style (\usepackage{sw20...}); when opensw
typesets one, it copies these files next to the document. If Scientific Word
5.x is installed (C:\sw55 and similar), its own files are used instead.

- Files from Scientific Word 5.5 (TCITeX\TeX\LaTeX\SWmacros): only those that
  carry the notice "This macro file is NOT proprietary and may be freely copied
  and distributed" (tcilatex.tex, the sw20*.sty styles, thmsupp.tex, tcibook.sty,
  ...).
- Written for opensw (MPL-2.0 license), in place of 5.5 files without that notice:
  thmsa.sty, thmsb.sty, thmsc.sty, thmsd.sty, thmdefs.sty (theorem numbering
  options), cmroman.tex, eulcmr.tex, ntroman.tex, tnroman.tex (font schemes;
  the Times ones use the psnfss Times fonts), ugmacs.tex, SLIDE.TEX, tcibook.cls,
  and jeep.sty (same page size, headings and commands as the original, with
  standard LaTeX; the original is not included).
- Left out: lamaple.tex, maplems.tex (Maple, non-commercial only), colorart.cls.
