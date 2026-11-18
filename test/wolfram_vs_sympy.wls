#!/usr/bin/env wolframscript
(* The Mathematica engine against the SymPy engine on requests the editor really sends:
   test/fixtures/wolfram/sympy.json holds them with SymPy's answers (recorded while the
   browser tests ran:  OPENSW_RECORD=/tmp/rec.jsonl node --import ./scripts/record-engine.mjs test/plots4.mjs).
   Numbers (plots) must agree; formulas are printed side by side to read.
   Run where Mathematica is installed:  wolframscript -file test/wolfram_vs_sympy.wls *)
dir = DirectoryName[$InputFileName];
Get[FileNameJoin[{dir, "..", "engine", "opensw_compute.wl"}], CharacterEncoding -> "UTF-8"];
recs = Import[FileNameJoin[{dir, "fixtures", "wolfram", "sympy.json"}], "RawJSON"];
fails = 0;
json[x_] := ByteArrayToString[ExportByteArray[x, "RawJSON", "Compact" -> True], "UTF-8"];
(* two lists of numbers or nulls agree: same places without a value (a few may differ at
   the edge of a domain), values within tol *)
agree[a_List, b_List, tol_] := Length[a] == Length[b] && Module[{pairs = Transpose[{Flatten[{a}], Flatten[{b}]}], both, nulls},
  both = Select[pairs, NumberQ[#[[1]]] && NumberQ[#[[2]]] &];
  nulls = Count[pairs, {x_, y_} /; NumberQ[x] =!= NumberQ[y]];
  nulls <= Max[2, 0.02 Length[pairs]] && AllTrue[both, Abs[#[[1]] - #[[2]]] <= tol (1 + Abs[#[[2]]]) &]];
agree[a_, b_, _] := a === b;
Do[
  Module[{t = AbsoluteTime[], m, s = r["sympy"], ok, note = ""},
    m = ImportByteArray[OpenSW`Private`answer[r["op"], r["json"]], "RawJSON"];
    ok = Which[
      s === Null || KeyExistsQ[s, "error"], note = "SymPy: " <> ToString[Lookup[s /. Null -> <||>, "error", "-"]]; True,
      KeyExistsQ[m, "error"] || KeyExistsQ[m, "fallback"], False,
      s["kind"] === "points", agree[m["x"], s["x"], 10^-9] && agree[m["y"], s["y"], 10^-6],
      s["kind"] === "grid", agree[m["z"], s["z"], 10^-6],
      s["kind"] === "values", agree[Flatten[m["values"]], Flatten[s["values"]], 10^-6],
      s["kind"] === "ode", agree[m["x"], s["x"], 10^-9] && Keys[m["y"]] === Keys[s["y"]] && And @@ MapThread[agree[#1, #2, 10^-3] &, {Values[m["y"]], Values[s["y"]]}],
      s["kind"] === "exam", Length[m["parts"]] == Length[s["parts"]] && Length[m["formulas"]] == Length[s["formulas"]] && StringFreeQ[json[m], "\:7b97\:4e0d\:51fa"],
      True, note = "SymPy: " <> json[KeyDrop[s, "kind"]]; True];
    If[!ok, fails++];
    Print[If[ok, "ok   ", "FAIL "], r["op"], " ", StringTake[r["json"], UpTo[70]], " -> ",
      StringTake[json[m], UpTo[160]], If[note == "", "", "\n       " <> StringTake[note, UpTo[160]]],
      " (", Round[1000 (AbsoluteTime[] - t)], "ms)"]],
  {r, recs}];
Print[fails, " failed of ", Length[recs]];
Exit[If[fails == 0, 0, 1]];
