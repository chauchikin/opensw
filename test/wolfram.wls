#!/usr/bin/env wolframscript
(* The Mathematica engine (engine/opensw_compute.wl) on the cases of
   test/fixtures/wolfram/cases.json (made by scripts/wolfram-cases.mjs).
   Run where Mathematica is installed:  wolframscript -file test/wolfram.wls *)
dir = DirectoryName[$InputFileName];
Get[FileNameJoin[{dir, "..", "engine", "opensw_compute.wl"}], CharacterEncoding -> "UTF-8"]; (* as the desktop app loads it *)
cases = Import[FileNameJoin[{dir, "fixtures", "wolfram", "cases.json"}], "RawJSON"];
fails = 0;
json[x_] := ByteArrayToString[ExportByteArray[x, "RawJSON", "Compact" -> True], "UTF-8"];
Do[
  Module[{t = AbsoluteTime[], r, ok, lat},
    r = ImportByteArray[OpenSW`Private`answer[c["op"], c["json"]], "RawJSON"];
    lat = StringDelete[Lookup[r, "latex", StringRiffle[Lookup[r, "solutions", {}], ";"]], WhitespaceCharacter];
    ok = Which[
      c["expect"] === "fallback", TrueQ[r["fallback"]],
      StringQ[c["expect"]] && StringStartsQ[c["expect"], "error:"], StringContainsQ[Lookup[r, "error", ""], StringDrop[c["expect"], 6]],
      BooleanQ[c["expect"]], r["value"] === c["expect"],
      c["expect"] === Null, !KeyExistsQ[r, "error"],
      True, !KeyExistsQ[r, "error"] && StringContainsQ[lat, c["expect"]]];
    If[!ok, fails++];
    Print[If[ok, "ok   ", "FAIL "], c["op"], " ", c["latex"], " -> ", json[r],
      " (", Round[1000 (AbsoluteTime[] - t)], "ms)"]],
  {c, cases}];
(* the line the desktop app reads: Chinese must come back as the same characters *)
Module[{b64, text, ok},
  b64 = StringReplace[ToString[Block[{WriteString = (#2 &)}, OpenSW`OpenSWCompute["check", BaseEncode[StringToByteArray["[\"Add\",\"x\",1]", "UTF-8"]]]]], "@@OPENSW@@" | "\n" -> ""];
  text = ByteArrayToString[BaseDecode[b64], "UTF-8"];
  ok = StringContainsQ[text, "\:8981\:6709\:7b49\:865f"]; (* "must have an equals sign"; written as codes because this file may be read in the system code page *)
  If[!ok, fails++];
  Print[If[ok, "ok   ", "FAIL "], "the answer line keeps Chinese: ", text]];
Print[fails, " failed of ", Length[cases]];
Exit[If[fails == 0, 0, 1]];
