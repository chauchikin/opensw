(* Mathematica engine of opensw: the same Compute menu as opensw_compute.py, done by a
   Wolfram kernel on the user's computer (Tools > Computation Engine > Mathematica).

   The desktop app keeps one kernel running and sends it lines like
     OpenSW`OpenSWCompute["factor", "<base64 of the MathJSON text>"]
   The answer is one line  @@OPENSW@@<base64 of the JSON answer>  with the same JSON as
   opensw_compute.compute(): {"kind": "value", "latex": ..} | {"kind": "solutions", ..} |
   {"kind": "boolean", ..} | {"error": ..}; {"fallback": true} for an operation this file
   does not know (the editor then asks SymPy).

   The answers are written as Scientific Word 5.5 (whose engine was MuPAD) writes them, the
   same rules as opensw_compute.py: decimals with 5 significant digits, \ln, \sin x without
   brackets, a fraction first (\frac{1}{2}\sqrt{2}), matrices in the question's brackets ...

   Variables typed in the editor live in the context OpenSWVars` (so a variable N or D
   is not Mathematica's N or D); each shows as its own name in the TeX answers. *)

BeginPackage["OpenSW`"];
OpenSWCompute::usage = "OpenSWCompute[op, base64json] prints the answer line for one computation.";
Begin["`Private`"];

$timeLimit = 60; (* seconds for one computation *)

unsupported[what_] := Throw[what, "unsupported"];
fallback[] := Throw[True, "fallback"];

(* ---------------- MathJSON -> Wolfram Language ---------------- *)

greek = <|"alpha" -> "\[Alpha]", "beta" -> "\[Beta]", "gamma" -> "\[Gamma]", "delta" -> "\[Delta]",
  "epsilon" -> "\[Epsilon]", "varepsilon" -> "\[CurlyEpsilon]", "zeta" -> "\[Zeta]", "eta" -> "\[Eta]",
  "theta" -> "\[Theta]", "vartheta" -> "\[CurlyTheta]", "iota" -> "\[Iota]", "kappa" -> "\[Kappa]",
  "lambda" -> "\[Lambda]", "mu" -> "\[Mu]", "nu" -> "\[Nu]", "xi" -> "\[Xi]", "rho" -> "\[Rho]",
  "sigma" -> "\[Sigma]", "tau" -> "\[Tau]", "upsilon" -> "\[Upsilon]", "phi" -> "\[Phi]",
  "varphi" -> "\[CurlyPhi]", "chi" -> "\[Chi]", "psi" -> "\[Psi]", "omega" -> "\[Omega]",
  "Gamma" -> "\[CapitalGamma]", "Delta" -> "\[CapitalDelta]", "Theta" -> "\[CapitalTheta]",
  "Lambda" -> "\[CapitalLambda]", "Xi" -> "\[CapitalXi]", "Sigma" -> "\[CapitalSigma]",
  "Phi" -> "\[CapitalPhi]", "Psi" -> "\[CapitalPsi]", "Omega" -> "\[CapitalOmega]",
  "Upsilon" -> "\[CapitalUpsilon]", "Pi" -> "\[CapitalPi]"|>;

(* how a variable name shows: x_1 -> x with subscript 1, alpha -> the Greek letter *)
display[name_String] := Module[{parts = StringSplit[name, "_", 2], base},
  base = Lookup[greek, parts[[1]], parts[[1]]];
  If[Length[parts] == 2, SubscriptBox[base, display[parts[[2]]]], base]];

(* the Wolfram symbol for a variable: OpenSWVars`v<name> (letters and digits kept, others
   coded). It never gets a value: definitions are applied by applyDefs. *)
$made = <||>;
var[name_String] := Lookup[$made, name, $made[name] = With[{s = Symbol["OpenSWVars`v" <> StringReplace[name,
    c : RegularExpression["[^A-Za-z0-9]"] :> "U" <> ToString[First[ToCharacterCode[c]]] <> "U"]], d = display[name]},
  MakeBoxes[s, TraditionalForm] := d;
  s]];

isVar[s_Symbol] := Context[s] === "OpenSWVars`";
isVar[_] := False;
userSymbols[e_] := DeleteDuplicates[Cases[e, s_Symbol /; isVar[s], {0, Infinity}, Heads -> True]];
(* variables, not function names: x in f(x), but not f *)
userVariables[e_] := SortBy[Complement[userSymbols[e], Cases[e, (h_Symbol /; isVar[h])[___] :> h, {0, Infinity}, Heads -> True]], nameOf];
nameOf[s_] := Replace[Keys[Select[$made, # === s &]], {{n_, ___} :> n, {} :> SymbolName[s]}];

(* while 5.5 computes with decimals, pi stays pi (2.5 pi + pi = 3.5 pi): piS until the end *)
MakeBoxes[piS, TraditionalForm] := "\[Pi]";

constants = <|"Pi" -> Pi, "ExponentialE" -> E, "ImaginaryUnit" -> I, "PositiveInfinity" -> Infinity,
  "NegativeInfinity" -> -Infinity, "ComplexInfinity" -> ComplexInfinity, "NaN" -> Indeterminate, "True" -> True, "False" -> False|>;

functions = <|"Sqrt" -> Sqrt, "Exp" -> Exp, "Ln" -> Log,
  "Sin" -> Sin, "Cos" -> Cos, "Tan" -> Tan, "Cot" -> Cot, "Sec" -> Sec, "Csc" -> Csc,
  "Arcsin" -> ArcSin, "Arccos" -> ArcCos, "Arctan" -> ArcTan, "Arccot" -> ArcCot,
  "Sinh" -> Sinh, "Cosh" -> Cosh, "Tanh" -> Tanh, "Coth" -> Coth,
  "Arsinh" -> ArcSinh, "Arcosh" -> ArcCosh, "Artanh" -> ArcTanh,
  "Floor" -> Floor, "Ceil" -> Ceiling, "Factorial" -> Factorial, "Binomial" -> Binomial,
  "Max" -> Max, "Min" -> Min, "Sign" -> Sign, "Gamma" -> Gamma, "Erf" -> Erf,
  "Real" -> Re, "Imaginary" -> Im, "Conjugate" -> Conjugate, "GCD" -> gcd55, "LCM" -> lcm55, "Mod" -> Mod,
  (* more of the functions 5.5 knows (sec^-1, arccoth, arg, J_n(x) ...) *)
  "Sech" -> Sech, "Csch" -> Csch, "Arcsec" -> ArcSec, "Arccsc" -> ArcCsc, "Arcoth" -> ArcCoth,
  "Arsech" -> ArcSech, "Arcsch" -> ArcCsch, "Argument" -> Arg, "Re" -> Re, "Im" -> Im, "Erfc" -> Erfc,
  "Zeta" -> Zeta, "Ei" -> ExpIntegralEi, "Si" -> SinIntegral, "Ci" -> CosIntegral,
  "BesselJ" -> BesselJ, "BesselY" -> BesselY, "BesselI" -> BesselI, "BesselK" -> BesselK|>;

(* an equation stays an equation while it is built (Equal[2, 3] would become False) *)
relations = <|"Equal" -> eq, "NotEqual" -> Unequal, "Less" -> Less, "LessEqual" -> LessEqual,
  "Greater" -> Greater, "GreaterEqual" -> GreaterEqual|>;
relationQ[e_] := MatchQ[e, _eq | _Equal | _Unequal | _Less | _LessEqual | _Greater | _GreaterEqual | _Inequality | _elem];

(* a decimal is a decimal (8.0 too), as in 5.5; with more than 15 digits, as many as written *)
number[s_String] := Which[
  StringMatchQ[s, RegularExpression["-?[0-9]+"]], FromDigits[StringDelete[s, "-"]] * If[StringStartsQ[s, "-"], -1, 1],
  StringMatchQ[s, RegularExpression["-?[0-9]*\\.?[0-9]*([eE][-+]?[0-9]+)?"]] && StringContainsQ[s, DigitCharacter],
    Module[{m = StringCases[s, RegularExpression["(-?)([0-9]*)\\.?([0-9]*)(?:[eE]([-+]?[0-9]+))?"] :> {"$1", "$2", "$3", "$4"}][[1]], digits, q},
      digits = m[[2]] <> m[[3]];
      q = If[m[[1]] == "-", -1, 1] * FromDigits[If[digits == "", "0", digits]] / 10^StringLength[m[[3]]] *
        10^If[m[[4]] == "", 0, FromDigits[StringDelete[m[[4]], "+" | "-"]] * If[StringStartsQ[m[[4]], "-"], -1, 1]];
      If[StringLength[digits] > 15, N[q, StringLength[digits]], N[q]]],
  s == "Infinity" || s == "+Infinity", Infinity,
  s == "-Infinity", -Infinity,
  True, unsupported["Number " <> s]];

(* the state of one computation (answer[] resets it): the names in the order they are written
   (the unknowns of A x = b), the brackets of a matrix answer (those of the first matrix written
   or defined; without one [ ] for lists, else ( )), and the names not to replace by their
   definitions (the parameters of a function being defined) *)
$names = {}; $delim = None; $listStyle = False; $product = False; $params = {}; $op = ""; $holdPi = False; $log10 = False;
noteMatrix[d_] := If[d === "list", $listStyle = True, If[$delim === None, $delim = d]];
answerDelim[] := Which[$delim =!= None, $delim, $listStyle && !$product, "[", True, "("];

build[True] := True;
build[False] := False;
build[n_Integer] := n;
build[x_Real] := x;
build[a_Association] := Which[
  KeyExistsQ[a, "num"], number[a["num"]],
  KeyExistsQ[a, "sym"], build[a["sym"]],
  True, unsupported["Text"]];
build[s_String] := Which[
  s == "Pi" && $holdPi, piS,
  KeyExistsQ[constants, s], constants[s],
  s == "Nothing", Nothing,
  s == "EmptySet", fset[],
  StringStartsQ[s, "unit_"], unit[StringDrop[s, 5]],
  StringStartsQ[s, "'"], unsupported["Text"],
  (* a matrix defined earlier: matrix arithmetic needs it now *)
  KeyExistsQ[$defs, s] && $defs[s][[1]] === None && MatrixQ[$defs[s][[2]]] && !MemberQ[$params, s],
    noteMatrix[Lookup[$matDelims, s, "("]]; $defs[s][[2]],
  True, If[!MemberQ[$names, s], AppendTo[$names, s]]; var[s]];
build[{}] := {};
build[{head_String, args___}] := buildHead[head, {args}];
build[other_] := unsupported[ToString[other]];

startsWith[n_, h_] := ListQ[n] && n =!= {} && First[n] === h;

buildHead["Error", _] := unsupported["The formula has notation that is not understood"];
(* y' as an unknown of its own (Solve for y', as 5.5) *)
buildHead["Prime", {f_String, k_Integer : 1}] /; !KeyExistsQ[$defs, f] := build[f <> StringRepeat["'", k]];
buildHead["Add", a_] := add55[build /@ a];
buildHead["Multiply", a_] := multiply55[build /@ a];
buildHead["Subtract", {x_, y_}] := add55[{build[x], -build[y]}];
(* D(x) = ..: a function named D (compute.js writes opensw_D): SymPy keeps it *)
buildHead["opensw_D", _] := fallback[];
buildHead["Subtract", {x_}] := -build[x];
buildHead["Negate", {x_}] := -build[x];
buildHead["Divide", {x_, y_}] := build[x] / build[y];
buildHead["Rational", {x_, y_}] := build[x] / build[y];
buildHead["Power" | "MatrixPower", {x_, y_}] := power55[build[x], y];
buildHead["Square", {x_}] := power55[build[x], 2];
buildHead["Root", {x_, n_}] := power55[build[x], {"Divide", 1, n}, True];
buildHead["Log", {x_, b_}] := Log[build[b], build[x]];
buildHead["Log", {x_}] := Log[10, build[x]];
buildHead["Lb", {x_}] := Log[2, build[x]];
(* \log x with the log base set to 10 (5.5's Computation Setup): shown \log_{10} x (see tex) *)
buildHead["Log10", {x_}] := Log[10, build[x]];
buildHead["Complex", {x_, y_}] := build[x] + I build[y];
buildHead["Degrees", {x_}] := build[x] If[$holdPi, piS, Pi] / 180;
(* \max_{1 \leq n \leq 10} f(n): over the integers in the range; \max of a matrix: its largest entry *)
buildHead[h : "Max" | "Min", {{"Tuple", "_", cond_, body_}}] := extremeOver[h, cond, body];
buildHead[h : "Max" | "Min", {m_}] /; MatrixQ[build[m]] := If[h == "Max", Max, Min][Flatten[build[m]]];
buildHead["Abs", {m_}] := With[{x = build[m]}, If[MatrixQ[x], Det[x], Abs[x]]];
buildHead["Exp", {m_}] := With[{x = build[m]}, If[MatrixQ[x], Simplify[MatrixExp[x]], Exp[x]]];
(* Dirac(i): undefined, as 5.5 *)
buildHead[h : "Dirac" | "Heaviside", {x_}] := With[{u = build[x]},
  If[NumericQ[u] && Im[u] != 0, Indeterminate, If[h == "Dirac", DiracDelta, HeavisideTheta][u]]];
(* MuPAD's AiryAi(z, n): n = 1 is the derivative *)
buildHead[h : "AiryAi" | "AiryBi", {z_, n_ : 0}] := If[build[n] === 1, If[h == "AiryAi", AiryAiPrime, AiryBiPrime], If[h == "AiryAi", AiryAi, AiryBi]][build[z]];
buildHead[h_String, a_] /; StringMatchQ[h, RegularExpression["(Normal|T|ChiSquare|F|Exponential|Weibull|Gamma|Beta|Cauchy|Uniform|Binomial|Poisson|Hypergeom)(Dist|Den|Inv)"]] :=
  distribution[h, build /@ Flatten[If[startsWith[#, "Tuple"], Rest[#], {#}] & /@ a, 1]];
(* \mathcal{L}(f), \mathcal{F}^{-1}(F, w, x) ...: 5.5's transforms, with its variables when not given *)
transformVars = <|"LaplaceTransform" -> {"t", "s"}, "InverseLaplaceTransform" -> {"s", "t"},
  "FourierTransform" -> {"x", "w"}, "InverseFourierTransform" -> {"w", "x"}|>;
buildHead[h_String, a_] /; KeyExistsQ[transformVars, h] := Module[{f = build[First[a]], xy},
  xy = If[Length[a] >= 3, build /@ a[[2 ;; 3]], var /@ transformVars[h]];
  If[ListQ[f] && Length[f] == 1 && MatrixQ[First[f]], f = First[f]];
  transform[applyDefs[f], xy[[1]], xy[[2]], h]];
(* a mod m, written in compute.js from 5.5's \func{mod}: Factor keeps it to factor mod m *)
buildHead["Modulo", {a_, m_}] := With[{x = build[a], n = build[m]}, If[$op === "factor", modH[x, n], modulo[x, n]]];
buildHead["Element", {x_, s_}] := elem[build[x], build[s]];
buildHead["Interval", {lo_, hi_}] := ivl[build[If[startsWith[lo, "Open"], lo[[2]], lo]], build[If[startsWith[hi, "Open"], hi[[2]], hi]], startsWith[lo, "Open"], startsWith[hi, "Open"]];
(* a_k in a sum; \hat{t}_{3} a name (5.5's parameters) *)
buildHead["Subscript", {{h : "OverHat" | "OverTilde", n_String}, k_}] /; IntegerQ[k] || StringQ[k] :=
  build[n <> If[h == "OverHat", "hat", "tilde"] <> "_" <> ToString[k]];
buildHead[h : "OverHat" | "OverTilde", {n_String}] := build[n <> If[h == "OverHat", "hat", "tilde"]];
buildHead["Subscript", {a_String, k_}] /; !MatrixQ[build[a]] && !FreeQ[build[k], _Symbol?isVar] := idx[a, build[k]];
(* A_{i,j}: an entry of a matrix *)
buildHead[h : "Subscript" | "At", {m_, ij__}] /; MatrixQ[build[m]] := Module[{x = build[m], k},
  k = build /@ If[Length[{ij}] == 1 && startsWith[First[{ij}], "Sequence" | "Delimiter" | "Tuple"], Rest[First[{ij}]], {ij}];
  If[Length[k] == 1 && MemberQ[Dimensions[x], 1], k = If[Length[x] == 1, {1, k[[1]]}, {k[[1]], 1}]];
  If[Length[k] != 2 || !AllTrue[Transpose[{k, Dimensions[x]}], IntegerQ[#[[1]]] && 1 <= #[[1]] <= #[[2]] &], unsupported["No such entry of the matrix"]];
  x[[k[[1]], k[[2]]]]];
(* \func{seq}_{n=1..4}(f): f at n = 1, 2, 3, 4 *)
buildHead["Seq", {f_, n_String, lo_, hi_}] := Module[{g = build[f], v = var[n], a = build[lo], b = build[hi]},
  If[!IntegerQ[a] || !IntegerQ[b] || b - a > 10000, unsupported["Needs whole numbers n=a..b"]];
  seqOut @@ Table[g /. v -> k, {k, a, b}]];
buildHead[h : "Union" | "Intersection" | "SetMinus", a_] := setOperation[h, build /@ a];
buildHead["Set", {{"Matrix", rows_, ___}}] /; piecewiseRows[rows] =!= None := Piecewise[piecewiseRows[rows], 0];
buildHead["Set", a_] := fset @@ DeleteDuplicates[build /@ a];
buildHead[h : "And" | "Or", a_] := If[h == "And", And, Or] @@ (toEqual /@ build /@ a);
buildHead["Not", {a_}] := Not[toEqual[build[a]]];
buildHead[h : "Delimiter" | "Hold" | "Parentheses", a_] := With[{items = build /@ DeleteCases[a, "Nothing"]},
  If[Length[items] == 1, First[items], items]];
buildHead["Block", a_] := build[Last[a]];
(* a list of numbers (1, 2, 3) is a vector: a row, shown in [ ] *)
buildHead[h : "List" | "Tuple", a_] := With[{items = build /@ a}, Which[
  items =!= {} && AllTrue[items, !ListQ[#] && !relationQ[#] && !BooleanQ[#] &], noteMatrix["list"]; {items},
  h == "Tuple", fallback[], (* (a, b) with formulas in it: SymPy *)
  True, items]];
buildHead["Matrix", {rows_, rest___}] := Module[{rs = If[startsWith[rows, "List"], Rest[rows], {rows}], cells},
  cells = If[startsWith[#, "List"], build /@ Rest[#], {build[#]}] & /@ rs;
  If[!FreeQ[cells, _?relationQ], Return[Flatten[cells]]]; (* a system of equations *)
  noteMatrix[If[{rest} =!= {} && First[{rest}] === "'[]'", "[", "("]];
  cells];
buildHead["Determinant", {m_}] := Det[build[m]];
buildHead["Transpose", {m_}] := Transpose[build[m]];
buildHead["Inverse", {m_}] := Inverse[build[m]];
(* z^*: the complex conjugate; A^*: the conjugate transpose *)
buildHead["ConjugateTranspose" | "Superstar", {m_}] := With[{x = build[m]}, If[MatrixQ[x], ConjugateTranspose[x], Conjugate[x]]];
buildHead["Dot", {u_, v_}] := dot55[build[u], build[v]];
buildHead["Cross", {u_, v_}] := cross55[build[u], build[v]];
buildHead["Norm", {m_, p_ : None}] := norm55[build[m], If[p === None, None, If[p === "'Frobenius'", "F", build[p]]]];
(* 5.5's grad f, div F, curl F, Laplacian f, in the basis variables x, y, z *)
buildHead[h : "Gradient" | "Divergence" | "Curl" | "Laplacian", {f_, basis___String}] := ($product = True;
  With[{r = vectorOp[ToLowerCase[h], applyDefs[build[f]], var /@ If[{basis} === {}, {"x", "y", "z"}, {basis}]]}, If[VectorQ[r], List /@ r, r]]);
buildHead[h : "Integrate" | "Sum" | "Product", {f_, lims___}] := Module[{body, v, ls},
  {body, v} = functionBody[f];
  ls = DeleteCases[limits /@ {lims}, {}];
  (* \int a x^3 without dx: in the last variable, as 5.5 *)
  If[ls === {} && h == "Integrate" && {lims} =!= {}, v = If[userVariables[body] === {}, None, Last[userVariables[body]]]];
  If[ls === {}, If[v === None, unsupported[If[h == "Integrate", "Don't know which variable to integrate over", "Don't know which variable to sum over"]], ls = {v}]];
  If[h == "Integrate", integrate55[body, ls], (h /. {"Sum" -> Sum, "Product" -> Product}) @@ Prepend[ls, body]]];
(* x -> a^+, a^- (a third argument 1, -1), or from both sides (undefined if they differ) *)
buildHead["Limit", {f_, a_, side___}] := Module[{body, v, r}, {body, v} = functionBody[f];
  If[v === None, unsupported["A limit needs a variable"]];
  r = Limit[body, v -> build[a], Sequence @@ Switch[{side}, {1}, {Direction -> "FromAbove"}, {-1}, {Direction -> "FromBelow"}, _, {}]];
  If[Head[r] === Interval, Indeterminate, r]];
(* definitions go in before differentiating: w(x,y) or w_0 defined, then d/dx of it; cases case by case *)
buildHead["D", {f_, vs___}] := With[{g = applyDefs[build[f]], xs = build /@ {vs}},
  If[Head[g] === Piecewise, Piecewise[{D[#[[1]], Sequence @@ xs], #[[2]]} & /@ g[[1]], D[g[[2]], Sequence @@ xs]], D[g, Sequence @@ xs]]];
(* f|_{x=a}, or f|_a^b = f(b) - f(a); f|_{x=1,y=2} *)
buildHead["EvaluateAt", {f_, a_, b___}] := Module[{body, v, names, at},
  {body, v} = functionBody[f];
  names = If[startsWith[f, "Function"], var /@ Drop[f, 2], {v}];
  at[j_] := Module[{x = If[startsWith[j, "Tuple"], build /@ Rest[j], build[j]]},
    x = If[Head[x] === eq, x[[2]], x];
    applyDefs[body] /. Thread[names[[;; Length[Flatten[{x}]]]] -> Flatten[{x}]]];
  If[{b} === {}, at[a], at[b] - at[a]]];
(* MuPAD commands written in a formula, which 5.5 gave to MuPAD as they are *)
buildHead["factor", {x_}] := shown[factorValue[build[x]]];
buildHead["expand", {x_}] := shown[Expand[build[x]]];
buildHead["float", {x_}] := N[build[x] /. piS -> Pi, 10];
buildHead["istrue", {x_}] := TrueQ[toEqual[build[x]]];
buildHead["solve", {x_, vs___}] := fset @@ (bracketed @@ (eq @@@ #) & /@ solveFor[build[x], build /@ {vs}, False]);
buildHead[h : "row" | "col", {m_, k_}] /; MatrixQ[build[m]] := With[{x = build[m], i = build[k]},
  If[!IntegerQ[i] || i < 1 || i > If[h == "row", Length[x], Length[First[x]]], unsupported["No such row or column"]];
  If[h == "row", {x[[i]]}, List /@ x[[All, i]]]];
buildHead["series", {f_, at_ : None, n_ : 5}] := mupadSeries[build[f], If[at === None, None, build[at]], build[n]];
buildHead["nextprime", {n_}] := nextprime[build[n]];
buildHead["divisors", {n_}] := With[{x = build[n]}, If[IntegerQ[x] && x != 0, bracketed @@ Divisors[x], divisors[x]]];
buildHead["contfrac", {x_, n_ : 10}] := continuedFraction[build[x], build[n]];
buildHead["swapRow", {m_, i_, j_}] := Module[{x = build[m], a = build[i], b = build[j]},
  If[!MatrixQ[x] || !AllTrue[{a, b}, IntegerQ[#] && 1 <= # <= Length[x] &], unsupported["swapRow needs a matrix and two of its rows"]];
  x[[{a, b}]] = x[[{b, a}]]; x];
buildHead[h_String, a_] /; KeyExistsQ[relations, h] := If[Length[a] > 2 && h != "Equal",
  And @@ MapThread[relations[h], {build /@ Most[a], build /@ Rest[a]}], (* 0 < x < 1 *)
  relations[h] @@ (build /@ a)];
buildHead[h_String, a_] /; KeyExistsQ[functions, h] := functions[h] @@ (build /@ a);
(* an unknown head is a function the user wrote: f(x), w_0(x), W(x), \Psi(y) *)
userFunctionName[h_String] := LowerCaseQ[StringTake[h, 1]] || StringLength[First[StringSplit[h, "_"]]] == 1 ||
  MemberQ[{"Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"}, First[StringSplit[h, "_"]]];
buildHead[h_String, a_] /; userFunctionName[h] := var[h] @@ (build /@ a);
(* notation this file does not know: SymPy answers *)
buildHead[h_String, _] := fallback[];

(* {"Function", {"Block", body}, "x"} -> {body, x}; a plain expression -> {expr, None} *)
functionBody[{"Function", body_, vs___}] := {build[body], If[{vs} === {}, None, var[First[{vs}]]]};
functionBody[f_] := {build[f], None};

(* {"Limits", "x", 0, 1} -> {x, 0, 1}; bounds that are "Nothing" are left out *)
limits[{"Limits" | "Tuple" | "Triple" | "Pair", parts___}] := With[{p = DeleteCases[build /@ {parts}, Nothing]},
  If[Length[p] == 1, First[p], p]];
limits[x_] := build[x];

(* the rows (value, condition) of a function defined by cases, or None *)
piecewiseRows[{"List", rows___}] := Module[{out = {}, r},
  Do[r = If[startsWith[row, "List"], Rest[row], {}];
    Which[
      Length[r] == 3 && r[[2]] === "'if'", AppendTo[out, {build[r[[1]]], toEqual[build[r[[3]]]]}],
      Length[r] == 2 && MemberQ[{"'otherwise'", "'else'"}, r[[2]]], AppendTo[out, {build[r[[1]]], True}],
      True, Return[None, Module]],
    {row, {rows}}];
  If[out === {}, None, out]];
piecewiseRows[_] := None;

(* gcd and lcm of numbers, or of polynomials (multiplied out, as 5.5 writes them); definitions go in first *)
gcd55[xs__] := With[{a = applyDefs /@ {xs}}, If[AllTrue[a, IntegerQ], GCD @@ a, Expand[PolynomialGCD @@ a]]];
lcm55[xs__] := With[{a = applyDefs /@ {xs}}, If[AllTrue[a, IntegerQ], LCM @@ a, Expand[PolynomialLCM @@ a]]];

(* a sum; a number added to a square matrix is that number times the identity (5.5) *)
add55[terms_] := Module[{k = FirstPosition[terms, _?MatrixQ, None, {1}], total},
  If[k === None, Return[Plus @@ terms]];
  total = terms[[k[[1]]]];
  Do[Which[
      !MatrixQ[t], If[Length[total] != Length[First[total]], unsupported["Only a square matrix can be added to a number"]];
        total = total + t IdentityMatrix[Length[total]],
      Dimensions[t] != Dimensions[total], unsupported["Matrices of different sizes cannot be added"],
      True, total = total + t],
    {t, Delete[terms, k]}];
  total];

(* a product, left to right: matrix products; two vectors of one length that cannot be
   multiplied as matrices give their dot product *)
multiply55[fs_] := Module[{out = First[fs]},
  Do[out = Which[
      MatrixQ[out] && MatrixQ[f], Which[
        Length[First[out]] == Length[f], out . f,
        MemberQ[Dimensions[out], 1] && MemberQ[Dimensions[f], 1] && Length[Flatten[out]] == Length[Flatten[f]], dot55[out, f],
        True, unsupported["These matrices cannot be multiplied: the sizes do not match"]],
      True, out f],
    {f, Rest[fs]}];
  out];

(* base^j: A^n (A^{-1} the inverse, A^0 the identity), A^H the Hermitian transpose, e^A; in
   Evaluate an odd root of a negative number is the real root (cube root of -8 = -2), as 5.5
   (a decimal to the power 1/3: the principal value, unless written as a root) *)
power55[b_, j_, radical_ : False] := Module[{n},
  If[MatrixQ[b],
    If[j === "H", Return[ConjugateTranspose[b]]];
    n = build[j];
    If[!IntegerQ[n], unsupported["A matrix can only be raised to a whole power"]];
    Return[MatrixPower[b, n]]];
  n = build[j];
  Which[
    MatrixQ[n], If[b =!= E, unsupported["Only e can be raised to a matrix"]]; Simplify[MatrixExp[n]],
    $op === "evaluate" && MatchQ[n, Rational[1, q_?OddQ]] && (IntegerQ[b] || Head[b] === Rational || radical && Head[b] === Real) && b < 0, -(-b)^n,
    True, b^n]];

(* 5.5: u . v = sum of u_i v_i^* *)
dot55[u_, v_] := If[MatrixQ[u] && MatrixQ[v] && MemberQ[Dimensions[u], 1] && MemberQ[Dimensions[v], 1] && Length[Flatten[u]] == Length[Flatten[v]],
  Total[Flatten[u] Conjugate[Flatten[v]]], multiply55[{u, v}]];

cross55[u_, v_] := Module[{a, b, c},
  If[!(MatrixQ[u] && MatrixQ[v]), Return[multiply55[{u, v}]]]; (* a number times a vector *)
  {a, b} = Flatten /@ {u, v};
  If[!(MemberQ[Dimensions[u], 1] && MemberQ[Dimensions[v], 1] && Length[a] == 3 && Length[b] == 3), unsupported["The cross product needs two vectors with 3 components"]];
  $product = True;
  c = Cross[a, b];
  If[Length[u] == 1, {c}, List /@ c]]; (* shaped as the first vector *)

(* ||v||, ||v||_p, ||v||_inf of a vector; ||A||_1, ||A||_inf, ||A||_F of a matrix, and ||A|| = ||A||_2,
   the largest singular value, which 5.5 gives as a decimal number *)
norm55[m_, p_] := Module[{x},
  If[!MatrixQ[m], Return[Abs[m]]];
  x = Flatten[m];
  Which[
    MemberQ[Dimensions[m], 1] || p === "F", Which[
      MemberQ[{None, 2, "F"}, p], Sqrt[Total[Abs[x]^2]],
      p === Infinity, Max[Abs[x]],
      IntegerQ[p] && p > 0, Total[Abs[x]^p]^(1/p),
      True, unsupported["The norm's subscript must be a positive integer or infinity"]],
    p === 1, Max[Total[Abs[m]]],
    p === Infinity, Max[Total[Abs[Transpose[m]]]],
    p === None || p === 2, If[FreeQ[m, _Symbol?isVar], N[Max[SingularValueList[N[m, 20]]], 10], Sqrt[Max[Eigenvalues[m . ConjugateTranspose[m]]]]],
    True, unsupported["A matrix norm is ||A||, ||A||_1, ||A||_2, ||A||_F or ||A||_inf"]]];

(* f(A) for a polynomial f defined earlier (f(x) = x^2 - 5x - 2x^0): x^0 is the identity *)
polynomialAtMatrix[x_, body_, m_] := (
  If[!PolynomialQ[body, x] || Length[m] != Length[First[m]], unsupported["Only a polynomial can be applied to a square matrix"]];
  Total[MapIndexed[#1 MatrixPower[m, #2[[1]] - 1] &, CoefficientList[body, x]]]);

(* a definite integral that does not converge: SymPy answers as 5.5 (left as it is with a pole
   inside, infinity when it grows without bound); an indefinite one as MuPAD gives it *)
integrate55[f_, {ls__}] /; Length[{ls}] == 1 && ListQ[ls] && Length[ls] == 3 :=
  Quiet[Check[Integrate[f, ls], fallback[], {Integrate::idiv, Integrate::idivp}]];
integrate55[f_, ls_] := antiderivative[Integrate[f, Sequence @@ ls]];
(* c ln(2x - 2) as c ln(x - 1) (they differ by a constant); a fraction with its numerator multiplied out *)
antiderivative[r_] := Module[{s = r /. Log[p_Plus] :> With[{c = Cases[{FactorTermsList[p]}, {k_?NumberQ, _} :> k][[1]]},
      If[Positive[c] && c != 1, Log[p / c], Log[p]]]},
  If[FreeQ[s, Integrate] && Head[s] === Times && !FreeQ[Denominator[s], _Symbol?isVar] && !FreeQ[Numerator[s], _Plus],
    Expand[Numerator[s]] / Denominator[s], s]];

(* \max_{1\leq n\leq 10} f(n), \min_{k\in [1,10]} f(k): over the integers in the range, as
   5.5 does; the term itself (\sin 8), not its value *)
extremeOver[h_, cond_, body_] := Module[{v, lo, hi, openLo, openHi, f, start, stop, terms},
  Which[
    startsWith[cond, "Element"] && startsWith[cond[[3]], "Interval"],
      v = cond[[2]];
      {lo, hi} = build[If[startsWith[#, "Open"], #[[2]], #]] & /@ cond[[3, 2 ;; 3]];
      {openLo, openHi} = startsWith[#, "Open"] & /@ cond[[3, 2 ;; 3]],
    MatchQ[cond, {"LessEqual" | "Less", _, _String, _}],
      {lo, v, hi} = {build[cond[[2]]], cond[[3]], build[cond[[4]]]};
      openLo = openHi = cond[[1]] == "Less",
    True, unsupported["Write the range as 1 \\leq n \\leq 10 or n \\in [1, 10]"]];
  f = build[body];
  start = If[openLo || !IntegerQ[lo], Floor[lo] + 1, lo];
  stop = If[openHi || !IntegerQ[hi], Ceiling[hi] - 1, hi];
  If[!IntegerQ[start] || !IntegerQ[stop] || stop - start > 10000, unsupported["Needs a range of at most 10000 integers"]];
  terms = Table[f /. var[v] -> k, {k, start, stop}];
  If[terms === {}, unsupported["The range has no integers"]];
  If[h == "Max", Last, First][SortBy[terms, N]]];

(* union, intersection and difference of sets; of listed elements as 5.5 does them, each
   name a different element ({1, 2} \cap {a, b} is empty) *)
setOperation[h_, sets_] := Module[{out},
  If[!AllTrue[sets, Head[#] === fset &], fallback[]]; (* intervals: SymPy *)
  out = List @@ First[sets];
  Do[With[{o = List @@ s}, out = Switch[h,
      "Union", Join[out, Select[o, !MemberQ[out, #] &]],
      "Intersection", Select[out, MemberQ[o, #] &],
      _, Select[out, !MemberQ[o, #] &]]],
    {s, Rest[sets]}];
  fset @@ out];

(* a mod m as 5.5 (MuPAD) computes it: of integers and fractions (1/5 mod 7 = 3, the inverse
   of 5), of the coefficients of a polynomial, of each entry of a matrix; mod a polynomial,
   the remainder *)
modulo[a_, m_] := Module[{gens},
  Which[
    MatrixQ[a], Map[modulo[#, m] &, a, {2}],
    IntegerQ[m] && m > 0, Which[
      IntegerQ[a], Mod[a, m],
      Head[a] === Rational, Mod[Numerator[a] PowerMod[Denominator[a], -1, m], m],
      (gens = userVariables[a]) =!= {} && PolynomialQ[a, gens], PolynomialMod[Expand[a], m],
      True, Mod[a, m]],
    userVariables[m] =!= {}, Expand[PolynomialRemainder[Expand[a], Expand[m], First[userVariables[m]]]],
    True, Mod[a, m]]];

(* 5.5's distribution functions: NormalDist(x; mu, sigma), TInv(p; n), PoissonDen(k; mu) ...:
   a number when all the arguments are numbers (as 5.5 gives them), else the formula *)
distributions = <|"Normal" -> {{0, 1}, NormalDistribution[#1, #2] &}, "T" -> {{}, StudentTDistribution},
  "ChiSquare" -> {{}, ChiSquareDistribution}, "F" -> {{}, FRatioDistribution},
  "Exponential" -> {{}, ExponentialDistribution[1/#] &}, "Weibull" -> {{}, WeibullDistribution},
  "Gamma" -> {{}, GammaDistribution}, "Beta" -> {{}, BetaDistribution}, "Cauchy" -> {{}, CauchyDistribution},
  "Uniform" -> {{}, UniformDistribution[{#1, #2}] &}, "Binomial" -> {{}, BinomialDistribution},
  "Poisson" -> {{}, PoissonDistribution}, "Hypergeom" -> {{}, HypergeometricDistribution[#3, #2, #1] &}|>;
distribution[h_, args0_] := Module[{kind, name, defaults, make, args = args0, d, r},
  kind = Which[StringEndsQ[h, "Dist"], "Dist", StringEndsQ[h, "Den"], "Den", True, "Inv"];
  name = StringDrop[h, -StringLength[kind]];
  {defaults, make} = distributions[name];
  If[Length[args] - 1 < Length[defaults], args = Join[args, Drop[defaults, Length[args] - 1]]];
  d = make @@ Rest[args];
  r = Quiet[Switch[kind, "Den", PDF[d, First[args]], "Dist", CDF[d, First[args]], _, InverseCDF[d, First[args]]]];
  If[AllTrue[args, NumericQ], N[r, 10], r]];

(* 5.5's transforms (MuPAD's): L f(s) = int_0^oo f(t) e^(-st) dt;  F f(w) = int f(x) e^(iwx) dx;
   F^-1 F(x) = 1/(2 pi) int F(w) e^(-iwx) dw (so F(1) = 2 pi delta(w)) *)
transform[f_?MatrixQ, x_, y_, h_] := Map[transform[#, x, y, h] &, f, {2}];
transform[f_, x_, y_, h_] := Switch[h,
  "LaplaceTransform", LaplaceTransform[f, x, y],
  "InverseLaplaceTransform", InverseLaplaceTransform[f, x, y] /. HeavisideTheta[y] -> 1, (* for t > 0, as 5.5 shows it *)
  "FourierTransform", FourierTransform[f, x, y, FourierParameters -> {1, 1}],
  _, Expand[InverseFourierTransform[f, x, y, FourierParameters -> {1, 1}]]];

(* MuPAD's series(f, x = a, n): the terms up to (x - a)^(n-1) in powers of x - a, and O((x - a)^n) *)
mupadSeries[f_, at_, n_] := Module[{x, a},
  {x, a} = Which[Head[at] === eq, List @@ at, isVar[at], {at, 0}, True, {mainVariable[f], 0}];
  If[!IntegerQ[n] || n < 1, unsupported["The order of series must be a positive whole number"]];
  Series[f, {x, a, n - 1}]];

(* MuPAD's nextprime: the smallest prime >= n *)
nextprime[n_?NumericQ] /; Im[n] == 0 := NextPrime[Ceiling[n] - 1];
(* numlib::contfrac(x, n): the continued fraction of x to n digits (10 if not given), as MuPAD
   writes it: 3 + 1/(7 + 1/(15 + ..)) *)
continuedFraction[x_, digits_] := Module[{v, terms = {}, p0 = 0, q0 = 1, p1 = 1, q1 = 0, rest, a, more = 1},
  If[!NumericQ[x] || Im[x] != 0 || !IntegerQ[digits] || digits < 1, Return[contfrac[x, digits]]];
  v = If[Head[x] === Rational || IntegerQ[x], x, Rationalize[N[x, digits + 30], 0]];
  rest = v;
  While[Length[terms] < 200,
    a = Floor[rest];
    AppendTo[terms, a];
    {p0, q0, p1, q1} = {p1, q1, a p1 + p0, a q1 + q0};
    If[rest == a, more = 0; Break[]];
    If[Abs[v - p1 / q1] < Abs[v] 10^-digits, Break[]];
    rest = 1 / (rest - a)];
  contfracOut[terms, more]];
buildHead["Subscript", {a_String, k_}] := build[a <> "_" <> ToString[build[k]]];
(* a_k with k a number: the name a_3 (a sum gives these) *)
idx[a_String, k_Integer] := build[a <> "_" <> ToString[k]];

(* ---------------- units (5.5's \unit{ft} ...) ---------------- *)

(* name -> {value in SI units, SI base units as "m kg s-2"}; prefixed SI units (km, mA, GHz,
   \mu m ...) are made from these *)
units = <|
  "m" -> {"1", "m"}, "kg" -> {"1", "kg"}, "s" -> {"1", "s"}, "A" -> {"1", "A"}, "K" -> {"1", "K"}, "mol" -> {"1", "mol"},
  "cd" -> {"1", "cd"}, "g" -> {"0.001", "kg"}, "rad" -> {"1", ""}, "sr" -> {"1", ""},
  "N" -> {"1", "kg m s-2"}, "J" -> {"1", "kg m2 s-2"}, "W" -> {"1", "kg m2 s-3"}, "Pa" -> {"1", "kg m-1 s-2"},
  "C" -> {"1", "A s"}, "V" -> {"1", "kg m2 s-3 A-1"}, "F" -> {"1", "kg-1 m-2 s4 A2"}, "Ohm" -> {"1", "kg m2 s-3 A-2"},
  "S" -> {"1", "kg-1 m-2 s3 A2"}, "Wb" -> {"1", "kg m2 s-2 A-1"}, "T" -> {"1", "kg s-2 A-1"}, "H" -> {"1", "kg m2 s-2 A-2"},
  "Hz" -> {"1", "s-1"}, "Bq" -> {"1", "s-1"}, "Ci" -> {"3.7e10", "s-1"}, "Gy" -> {"1", "m2 s-2"}, "Sv" -> {"1", "m2 s-2"},
  "lm" -> {"1", "cd"}, "lx" -> {"1", "cd m-2"}, "phot" -> {"10000", "cd m-2"}, "sb" -> {"10000", "cd m-2"}, "G" -> {"0.0001", "kg s-2 A-1"},
  "min" -> {"60", "s"}, "h" -> {"3600", "s"}, "d" -> {"86400", "s"}, "y" -> {"31557600", "s"},
  "Angstrom" -> {"1e-10", "m"}, "in" -> {"0.0254", "m"}, "ft" -> {"0.3048", "m"}, "yd" -> {"0.9144", "m"}, "mi" -> {"1609.344", "m"},
  "nmi" -> {"1852", "m"}, "au" -> {"149597870700", "m"}, "ly" -> {"9460730472580800", "m"}, "pc" -> {"3.0856775814913673e16", "m"},
  "acre" -> {"4046.8564224", "m2"}, "hectare" -> {"10000", "m2"},
  "l" -> {"0.001", "m3"}, "L" -> {"0.001", "m3"}, "gal" -> {"0.003785411784", "m3"}, "qt" -> {"0.000946352946", "m3"}, "pint" -> {"0.000473176473", "m3"},
  "lb" -> {"0.45359237", "kg"}, "oz" -> {"0.028349523125", "kg"}, "slug" -> {"14.593902937206", "kg"}, "ton" -> {"907.18474", "kg"},
  "u" -> {"1.66053906660e-27", "kg"}, "lbf" -> {"4.4482216152605", "kg m s-2"}, "ozf" -> {"0.27801385095378", "kg m s-2"},
  "dyn" -> {"1e-5", "kg m s-2"}, "erg" -> {"1e-7", "kg m2 s-2"}, "cal" -> {"4.1868", "kg m2 s-2"}, "kcal" -> {"4186.8", "kg m2 s-2"},
  "Btu" -> {"1055.05585262", "kg m2 s-2"}, "eV" -> {"1.602176634e-19", "kg m2 s-2"}, "hp" -> {"745.69987158227", "kg m2 s-3"},
  "bar" -> {"100000", "kg m-1 s-2"}, "atm" -> {"101325", "kg m-1 s-2"}, "torr" -> {"133.32236842105", "kg m-1 s-2"},
  "mmHg" -> {"133.322387415", "kg m-1 s-2"}, "psi" -> {"6894.757293168", "kg m-1 s-2"}|>;
prefixes = <|"a" -> "1e-18", "f" -> "1e-15", "p" -> "1e-12", "n" -> "1e-9", "mu" -> "1e-6", "m" -> "1e-3", "c" -> "1e-2", "d" -> "1e-1",
  "k" -> "1e3", "M" -> "1e6", "G" -> "1e9", "T" -> "1e12", "P" -> "1e15", "E" -> "1e18"|>;
prefixed = RegularExpression["^(a|f|p|n|mu|m|c|d|k|M|G|T|P|E)(m|s|g|A|K|mol|N|J|W|Pa|C|V|F|S|T|H|Wb|Hz|l|L|eV|bar|rad|Ohm)$"];
siBase = {"m", "kg", "s", "A", "K", "mol", "cd"};

(* a unit is unit55["ft"], shown \mathrm{ft} *)
unit[name_String] := If[KeyExistsQ[units, name] || StringMatchQ[name, prefixed], unit55[name], unsupported["The unit " <> name]];
(* a unit's factor: exact if it is a whole number, else a decimal (as 5.5 converts) *)
unitFactor[t_String] := If[StringMatchQ[t, DigitCharacter ..], ToExpression[t], N[number[t]]];
siValue[name_String] := Module[{factor, dims, p, base},
  {factor, dims} = If[KeyExistsQ[units, name], units[name],
    {p, base} = StringCases[name, prefixed :> {"$1", "$2"}][[1]];
    {If[base == "g", N[unitFactor[prefixes[p]] / 1000], N[unitFactor[prefixes[p]] unitFactor[units[base][[1]]]]], units[base][[2]]}];
  If[StringQ[factor], factor = unitFactor[factor]];
  factor * Times @@ (StringCases[#, RegularExpression["([A-Za-z]+)(-?\\d*)$"] :> unit55["$1"]^If["$2" == "", 1, ToExpression["$2"]]][[1]] & /@ StringSplit[dims])];
inSI[e_] := e /. unit55[u_] /; !MemberQ[siBase, u] :> siValue[u];
unitsIn[e_] := DeleteDuplicates[Cases[e, _unit55, {0, Infinity}]];

(* ---------------- definitions and assumptions ---------------- *)

(* Compute > Definitions: x = 3 or f(x) = x^2, used by every later computation.
   $defs: name -> {argument symbols or None, value}; applyDefs puts them into a formula.
   a_n = f(n) with n on the right is a function of n too ($sequences: a -> {n, f(n)}) *)
$defs = <||>; $matDelims = <||>; $sequences = <||>; $numeric = <||>; $problems = <||>;
defRules[] := Join[
  KeyValueMap[Function[{name, d}, If[d[[1]] === None, var[name] -> d[[2]],
    With[{ps = d[[1]], body = d[[2]]}, var[name][args___] /; Length[{args}] == Length[ps] :>
      If[Length[ps] == 1 && MatrixQ[First[{args}]], polynomialAtMatrix[First[ps], body, First[{args}]], body /. Thread[ps -> {args}]]]]], $defs],
  KeyValueMap[Function[{base, d}, idx[base, k_] :> (d[[2]] /. d[[1]] -> k)], $sequences],
  (* y of Solve ODE > Numeric: y(1) a number, y applied to a column a column of values *)
  Flatten[Function[name, {var[name][t_?NumericQ] :> numericAt[name, t], var[name][m_?MatrixQ] :> Map[numericAt[name, #] &, m, {2}]}] /@ Keys[$numeric]]];
sequenceTerms[e_] := Flatten[KeyValueMap[Function[{base, d}, Cases[userSymbols[e],
  s_ /; StringMatchQ[nameOf[s], base <> "_" ~~ DigitCharacter ..] :> (s -> (d[[2]] /. d[[1]] -> ToExpression[StringDrop[nameOf[s], StringLength[base] + 1]]))]], $sequences]];
applyDefs[e_] := If[$defs === <||> && $sequences === <||> && $numeric === <||>, e, FixedPoint[ReplaceAll[ReplaceAll[#, sequenceTerms[#]], defRules[]] &, e, 5]];
expr[j_] := applyDefs[build[j]];

(* x = a + 1 keeps a (its value when x is used, as 5.5); x := a + 1 (full) puts in a's value now.
   f(x) = x^2: x is the function's own, whatever x is defined as. *)
define[j_, full_, subscript_ : None] := Module[{lhs, r, m},
  If[!MatchQ[j, {"Equal", _, _}], unsupported["Write a definition as x = 3 or f(x) = x^2"]];
  lhs = j[[2]];
  Which[
    StringQ[lhs] && !KeyExistsQ[constants, lhs],
      r = Block[{$params = {lhs}}, If[full, applyDefs[build[j[[3]]]], build[j[[3]]]]];
      $defs[lhs] = {None, r}; KeyDropFrom[$numeric, lhs];
      If[MatrixQ[r], $matDelims[lhs] = answerDelim[]];
      (* a_n = n^2/2^n with n on the right: n is an argument (5.5's Interpret Subscript), unless
         chosen otherwise in its dialog: "argument" (d_n = 7) or "name" (c_n = n^2 is one name) *)
      m = StringCases[lhs, RegularExpression["^([A-Za-z])_([A-Za-z])$"] :> {"$1", "$2"}];
      If[m =!= {}, If[subscript === "argument" || (subscript === None && !FreeQ[r, var[m[[1, 2]]]]),
        $sequences[m[[1, 1]]] = {var[m[[1, 2]]], r}, KeyDropFrom[$sequences, m[[1, 1]]]]];
      value[eq[var[lhs], r]],
    ListQ[lhs] && Length[lhs] > 1 && StringQ[First[lhs]] && userFunctionName[First[lhs]] && AllTrue[Rest[lhs], StringQ],
      r = Block[{$params = Rest[lhs]}, If[full, applyDefs[build[j[[3]]]], build[j[[3]]]]];
      $defs[First[lhs]] = {var /@ Rest[lhs], r}; KeyDropFrom[$numeric, First[lhs]]; value[eq[var[First[lhs]] @@ (var /@ Rest[lhs]), r]],
    True, unsupported["The left side must be a name or a function such as f(x)"]]];

showDefinitions[] := solutions[Join[KeyValueMap[Function[{name, d},
  tex[eq[If[d[[1]] === None, var[name], var[name] @@ d[[1]]], d[[2]]]]], $defs],
  DeleteDuplicates[$problems[#[[1]]]["shown"] & /@ Values[$numeric]]]]; (* a system once *)

(* Assumptions about variables (5.5's assume, additionally, unassume, about). Variables are
   complex unless assumed otherwise, as in 5.5: assume(real) makes all of them real,
   assume(x, positive) one of them. $assumed: name -> properties ("" is every variable);
   $ranges: name -> {the real numbers allowed for x or Re x, those for Im x or None}, as
   conditions on tt *)
$assumed = <||>; $ranges = <||>;
properties = {"real", "positive", "negative", "integer", "nonzero", "complex"};
flipped = <|"Less" -> "Greater", "LessEqual" -> "GreaterEqual", "Greater" -> "Less", "GreaterEqual" -> "LessEqual", "NotEqual" -> "NotEqual"|>;
propsOf[name_] := Lookup[$assumed, name, Lookup[$assumed, "", {}]];
(* what is known of the variable v, as a condition *)
assumptionOf[v_] := Module[{n = nameOf[v], ps, r},
  ps = propsOf[n];
  r = And @@ Join[
    If[MemberQ[ps, "real"] || MemberQ[ps, "positive"] || MemberQ[ps, "negative"] || MemberQ[ps, "integer"], {Element[v, Reals]}, {}],
    If[MemberQ[ps, "integer"], {Element[v, Integers]}, {}],
    If[MemberQ[ps, "positive"], {v > 0}, {}], If[MemberQ[ps, "negative"], {v < 0}, {}],
    If[MemberQ[ps, "nonzero"], {v != 0}, {}]];
  If[KeyExistsQ[$ranges, n], With[{re = $ranges[n][[1]], im = $ranges[n][[2]]},
    r = r && If[im === None, Element[v, Reals] && (re /. tt -> v), (re /. tt -> Re[v]) && (im /. tt -> Im[v])]]];
  r];
assumptions[e_] := And @@ (assumptionOf /@ userVariables[e]);
assumedQ[] := $assumed =!= <||> || $ranges =!= <||>;
realQ[v_] := TrueQ[Simplify[Element[v, Reals], assumptionOf[v]]];

(* the real numbers allowed (a condition on tt): \mathbb{R}, \mathbb{R}\setminus\{0\}, intervals *)
setTeX[c_] := Module[{r = Reduce[c, tt, Reals], holes = Reduce[!c, tt, Reals]},
  Which[
    r === True, "\\mathbb{R}",
    MatchQ[holes, (tt == _) | Or[(tt == _) ..]], "\\mathbb{R}\\setminus \\left\\{" <> StringRiffle[tex /@ Cases[{holes}, tt == p_ :> p, Infinity], ","] <> "\\right\\}",
    True, intervalsTeX[r, tt]]];
rangeTeX[name_] := With[{re = $ranges[name][[1]], im = $ranges[name][[2]]},
  If[im =!= None, setTeX[re] <> "+i" <> setTeX[im],
    If[MemberQ[propsOf[name], "integer"], "\\mathbb{Z}\\cap ", ""] <> setTeX[re]]];

(* what is known of e, as a set as 5.5 writes it: Z \cap (0, \infty), \mathbb{R}, Z \cap [0, \infty) *)
domainOf[e_] := Module[{a = assumptions[e], is, parts},
  is[c_] := TrueQ[Simplify[c, a]];
  parts = If[is[Element[e, Integers]], {"\\mathbb{Z}"}, {}];
  Which[
    is[e > 0], AppendTo[parts, "\\left(0,\\infty\\right)"],
    is[e < 0], AppendTo[parts, "\\left(-\\infty,0\\right)"],
    is[e >= 0], AppendTo[parts, "\\left[0,\\infty\\right)"],
    is[e <= 0], AppendTo[parts, "\\left(-\\infty,0\\right]"],
    parts === {}, parts = {If[is[Element[e, Reals]], "\\mathbb{R}", "\\mathbb{C}"] <> If[is[e != 0], "\\setminus\\left\\{0\\right\\}", ""]}];
  StringRiffle[parts, "\\cap "]];

(* x < 10, x \neq 0, Re(z) > 0 (MathJSON) -> {name, "re", "im" or None, the condition on tt}, or None *)
relationOf[r_] := Module[{found = None},
  If[!(ListQ[r] && Length[r] == 3 && KeyExistsQ[flipped, r[[1]]]), Return[None]];
  Do[Module[{side = s[[1]], other = s[[2]], head = s[[3]], part = None, c},
      If[ListQ[side] && Length[side] == 2 && MemberQ[{"Re", "Real", "Im", "Imaginary"}, side[[1]]] && StringQ[side[[2]]],
        part = If[MemberQ[{"Re", "Real"}, side[[1]]], "re", "im"]; side = side[[2]]];
      If[StringQ[side] && !KeyExistsQ[constants, side] && !MemberQ[properties, ToLowerCase[side]],
        c = build[other];
        If[!(NumericQ[c] && Im[c] == 0), Return[None, Module]];
        found = {side, part, If[head == "NotEqual", tt != c, relations[head][tt, c]]};
        Break[]]],
    {s, {{r[[2]], r[[3]], r[[1]]}, {r[[3]], r[[2]], flipped[r[[1]]]}}}];
  found];

(* assume(x < 10), additionally(x \neq 0), assume(Re(z) > 0): kept as conditions (for about) and
   as properties (x \neq 0: nonzero; x > 0: positive) *)
assumeRange[head_, name_, part_, allowed_] := Module[{ps, old, re, im, new = {}},
  ps = If[head == "additionally", propsOf[name], {}];
  old = If[head == "additionally", Lookup[$ranges, name, None], None];
  If[old === None, old = {Which[MemberQ[ps, "positive"], tt > 0, MemberQ[ps, "negative"], tt < 0, MemberQ[ps, "nonzero"], tt != 0, True, True],
    If[MemberQ[ps, "real"] || MemberQ[ps, "positive"] || MemberQ[ps, "negative"], None, True]}];
  {re, im} = old;
  Switch[part,
    None, re = re && allowed; im = None,
    "re", re = re && allowed; If[im === None, im = True],
    _, im = If[im === None, True, im] && allowed];
  re = Reduce[re, tt, Reals]; If[im =!= None, im = Reduce[im, tt, Reals]];
  If[re === False || im === False, unsupported["These assumptions contradict each other"]];
  If[MemberQ[ps, "integer"] && im === None, AppendTo[new, "integer"]];
  If[im === None,
    AppendTo[new, "real"];
    Which[
      TrueQ[Resolve[ForAll[tt, re, tt > 0], Reals]], AppendTo[new, "positive"],
      TrueQ[Resolve[ForAll[tt, re, tt < 0], Reals]], AppendTo[new, "negative"]];
    If[!TrueQ[re /. tt -> 0], AppendTo[new, "nonzero"]]];
  $assumed[name] = new;
  $ranges[name] = {re, im};
  rangeTeX[name]];

(* {"assume", "Real"}, {"assume", "x", "positive"}, {"additionally", "n", "integer"},
   {"additionally", {"Less", "x", 10}}, {"unassume", "x"}, {"about", "n"} -> the LaTeX 5.5 answers with *)
assume[j_] := Module[{head = First[j], args, names, props, key, ps, found},
  args = If[StringQ[#] && MemberQ[properties, ToLowerCase[#]], ToLowerCase[#], #] & /@ Rest[j];
  If[!AllTrue[args, StringQ],
    If[head == "about" && Length[args] == 1, Return[domainOf[expr[First[args]]]]]; (* about(n^2) *)
    found = If[Length[args] == 1 && MemberQ[{"assume", "additionally"}, head], relationOf[First[args]], None];
    If[found === None, unsupported["Write an assumption as assume(x, positive), assume(x < 3) or assume(Re(z) > 0)"]];
    Return[assumeRange[head, Sequence @@ found]]];
  names = Select[args, !MemberQ[properties, #] &];
  props = Select[args, MemberQ[properties, #] &];
  If[Length[names] > 1 || (head != "about" && Length[props] > 1),
    unsupported["Write assume(real) or assume(x, positive); allowed: real, complex, integer, positive, negative, nonzero"]];
  key = If[names === {}, "", First[names]];
  Switch[head,
    "about", Which[
      KeyExistsQ[$ranges, key], rangeTeX[key],
      key == "", If[KeyExistsQ[$assumed, ""], domainOf[var["t"]], "\\operatorname{Global}"],
      !KeyExistsQ[$assumed, key] && !KeyExistsQ[$assumed, ""], tex[var[key]],
      True, domainOf[var[key]]],
    "unassume", KeyDropFrom[$assumed, key]; KeyDropFrom[$ranges, key]; If[key == "", "\\operatorname{complex}", tex[var[key]]],
    _, If[props === {}, unsupported["Give an assumption: real, complex, integer, positive, negative or nonzero"]];
      ps = If[head == "additionally", propsOf[key], {}];
      If[First[props] != "complex", ps = Union[ps, props]];
      If[(MemberQ[ps, "positive"] && MemberQ[ps, "negative"]), unsupported["These assumptions contradict each other"]];
      If[head == "assume", KeyDropFrom[$ranges, key]];
      If[ps =!= {} || key != "", $assumed[key] = ps, KeyDropFrom[$assumed, ""]]; (* assume(complex): back to the default *)
      If[KeyExistsQ[$ranges, key], rangeTeX[key], domainOf[var[If[key == "", "t", key]]]]]];

(* ---------------- answers in LaTeX, as 5.5 writes them ---------------- *)

greekTeX = <|"alpha" -> "\\alpha", "beta" -> "\\beta", "gamma" -> "\\gamma", "delta" -> "\\delta",
  "epsilon" -> "\\epsilon", "varepsilon" -> "\\varepsilon", "zeta" -> "\\zeta", "eta" -> "\\eta",
  "theta" -> "\\theta", "vartheta" -> "\\vartheta", "iota" -> "\\iota", "kappa" -> "\\kappa",
  "lambda" -> "\\lambda", "mu" -> "\\mu", "nu" -> "\\nu", "xi" -> "\\xi", "rho" -> "\\rho",
  "sigma" -> "\\sigma", "tau" -> "\\tau", "upsilon" -> "\\upsilon", "phi" -> "\\phi",
  "varphi" -> "\\varphi", "chi" -> "\\chi", "psi" -> "\\psi", "omega" -> "\\omega",
  "Gamma" -> "\\Gamma", "Delta" -> "\\Delta", "Theta" -> "\\Theta", "Lambda" -> "\\Lambda", "Xi" -> "\\Xi",
  "Sigma" -> "\\Sigma", "Phi" -> "\\Phi", "Psi" -> "\\Psi", "Omega" -> "\\Omega", "Upsilon" -> "\\Upsilon", "Pi" -> "\\Pi"|>;

(* a name as TeX: x_1 -> x_{1}, alpha -> \alpha, Zhat -> \hat{Z} (5.5's \hat{Z}), u' -> u^{\prime } *)
texName[name_String] := Module[{parts = StringSplit[name, "_", 2], base, primes, t},
  base = StringDelete[parts[[1]], "'"];
  primes = StringCount[parts[[1]], "'"];
  t = Which[
    KeyExistsQ[greekTeX, base], greekTeX[base],
    StringLength[base] > 3 && StringEndsQ[base, "hat"], "\\hat{" <> texName[StringDrop[base, -3]] <> "}",
    StringLength[base] > 5 && StringEndsQ[base, "tilde"], "\\tilde{" <> texName[StringDrop[base, -5]] <> "}",
    True, base];
  If[primes > 0, t = t <> "^{" <> StringRepeat["\\prime ", primes] <> "}"];
  If[Length[parts] == 2, t <> "_{" <> texName[parts[[2]]] <> "}", t]];

(* a decimal as 5.5 shows it (5 significant digits shown): a number of at most 5 digits as
   it is (0.2, 3.0, 15625.0), others rounded to 5 digits (22.460); below 0.1 or from 10^5 on
   as d.dddd x 10^k (6.8068 x 10^{-2}) *)
decimalString[n_Integer, d_Integer] := Module[{s = IntegerString[n]},
  If[d <= 0, Return[s <> StringRepeat["0", -d] <> ".0"]];
  s = StringPadLeft[s, Max[StringLength[s], d + 1], "0"];
  StringInsert[s, ".", StringLength[s] - d + 1]];
exactDecimal[q_] := Module[{d = 0}, While[!IntegerQ[q 10^d] && d < 40, d++]; decimalString[q 10^d, d]];
shownFloat[x_Real] := Module[{v = Rationalize[Abs[x], 0], e, d10, exact, k, m5, s, z},
  If[v == 0, Return["0.0"]];
  e = RealDigits[v, 10, 1][[2]] - 1;
  d10 = Round[v 10^(9 - e)];
  If[d10 >= 10^10, e++; d10 = Round[v 10^(9 - e)]];
  v = d10 10^(e - 9); (* the number as computed, to 10 digits *)
  z = IntegerExponent[d10, 10];
  exact = IntegerLength[d10] - z <= 5;
  k = e; m5 = Round[v 10^(4 - k)];
  If[m5 >= 10^5, k++; m5 = Round[v 10^(4 - k)]];
  s = If[-1 <= k < 5,
    If[exact, exactDecimal[v], decimalString[m5, 4 - k]],
    If[exact, With[{m = IntegerString[d10 / 10^z]}, StringTake[m, 1] <> "." <> If[StringLength[m] == 1, "0", StringDrop[m, 1]]],
      StringInsert[IntegerString[m5], ".", 2]] <> "\\times 10^{" <> ToString[k] <> "}"];
  If[x < 0, "-" <> s, s]];

mk1 = FromCharacterCode[1]; mk2 = FromCharacterCode[2];
(* sin x, \ln x, \cos \frac{2}{9}\pi without brackets, as 5.5; brackets for a sum, a minus sign
   or a function inside (and where the next factor could be read as part of it, see tex) *)
bareNames = <|Sin -> "\\sin", Cos -> "\\cos", Tan -> "\\tan", Cot -> "\\cot", Sec -> "\\sec", Csc -> "\\csc",
  Sinh -> "\\sinh", Cosh -> "\\cosh", Tanh -> "\\tanh", Coth -> "\\coth", Log -> "\\ln", log10 -> "\\log_{10}",
  ArcSin -> "\\arcsin", ArcCos -> "\\arccos", ArcTan -> "\\arctan", ArcSinh -> "\\operatorname{arcsinh}",
  ArcCosh -> "\\operatorname{arccosh}", ArcTanh -> "\\operatorname{arctanh}", sinI -> "\\sin", cosI -> "\\cos"|>;
namedFunctions = <|Erf -> "\\operatorname{erf}", Erfc -> "\\operatorname{erfc}", Sign -> "\\operatorname{sign}",
  Re -> "\\operatorname{Re}", Im -> "\\operatorname{Im}", Arg -> "\\arg", Gamma -> "\\Gamma", Zeta -> "\\zeta",
  DiracDelta -> "\\operatorname{Dirac}", HeavisideTheta -> "\\operatorname{Heaviside}", UnitStep -> "\\operatorname{Heaviside}",
  ExpIntegralEi -> "\\operatorname{Ei}", SinIntegral -> "\\operatorname{Si}", CosIntegral -> "\\operatorname{Ci}",
  ArcSec -> "\\operatorname{arcsec}", ArcCsc -> "\\operatorname{arccsc}", ArcCot -> "\\operatorname{arccot}",
  ArcCoth -> "\\operatorname{arccoth}", ArcSech -> "\\operatorname{arcsech}", ArcCsch -> "\\operatorname{arccsch}",
  Sech -> "\\operatorname{sech}", Csch -> "\\operatorname{csch}", Max -> "\\max", Min -> "\\min", GCD -> "\\gcd",
  LCM -> "\\operatorname{lcm}", nextprime -> "\\operatorname{nextprime}", divisors -> "\\operatorname{divisors}",
  contfrac -> "\\operatorname{contfrac}"|>;
bessel = <|BesselJ -> "J", BesselY -> "Y", BesselI -> "I", BesselK -> "K"|>;
plainHeads = {Times, Power, Rational, Complex, DirectedInfinity, unit55, idx};
compoundQ[u_] := !FreeQ[u, _Plus | (h_Symbol /; !MemberQ[plainHeads, h])[___] | _Integrate | _Sum | _Limit | _Derivative];
negativeQ[u_] := (NumberQ[u] && Im[u] == 0 && u < 0) || (Head[u] === Times && negativeQ[First[u]]) ||
  (Head[u] === Complex && Re[u] == 0 && Im[u] < 0);
bareTeX[name_, u_, power_ : None] := With[{h = name <> If[power === None, "", "^{" <> power <> "}"]},
  If[!compoundQ[u] && !negativeQ[u], h <> mk1 <> texE[u] <> mk2, h <> "\\left(" <> texE[u] <> "\\right)"]];

(* how tightly a form binds: a sum 10, a product 20, a power 30, a name or number 100 *)
precOf[e_] := Which[
  relationQ[e] || MatchQ[e, _And | _Or], 5,
  Head[e] === Plus || Head[e] === seqOut, 10,
  Head[e] === Complex, Which[Re[e] != 0, 10, Im[e] == 1, 100, True, 20],
  Head[e] === Times || Head[e] === Rational || Head[e] === Inactive[Times] || Head[e] === im55, 20,
  NumberQ[e] && e < 0, 20,
  Head[e] === Power, If[MatchQ[e[[2]], Rational[1, _]] || negativeQ[e[[2]]] && e[[1]] =!= E, 100, 30],
  True, 100];
paren[e_, p_] := If[precOf[e] < p, "\\left(" <> texE[e] <> "\\right)", texE[e]];
args[l_List] := StringRiffle[texE /@ l, ","];

texE[n_Integer] := ToString[n];
texE[r_Rational] := If[r < 0, "-", ""] <> "\\frac{" <> ToString[Abs[Numerator[r]]] <> "}{" <> ToString[Denominator[r]] <> "}";
texE[x_Real] := shownFloat[x];
texE[c_Complex] := Module[{re = Re[c], im = Im[c], i},
  i = Which[im == 1, "i", im == -1, "-i", True, texE[im] <> " i"];
  Which[re == 0, i, StringStartsQ[i, "-"], texE[re] <> i, True, texE[re] <> "+" <> i]];
texE[DirectedInfinity[1]] := "\\infty";
texE[DirectedInfinity[-1]] := "-\\infty";
texE[DirectedInfinity[]] := "\\tilde{\\infty}";
texE[s_Symbol] := Which[
  s === Pi || s === piS, "\\pi", s === E, "e", s === Indeterminate, "\\operatorname{undefined}",
  s === True, "true", s === False, "false", s === EulerGamma, "\\gamma",
  isVar[s], texName[nameOf[s]],
  True, ToString[TeXForm[s]]];
texE[p_Plus] := Module[{ts = orderTerms[List @@ p], out},
  out = texE[First[ts]];
  Do[With[{s = texE[t]}, out = out <> If[StringStartsQ[s, "-"], s, "+" <> s]], {t, Rest[ts]}];
  out];
texE[t_Times] := texTimes[List @@ t];
texE[Inactive[Times][f___]] := texTimes[{f}];
texE[Power[b_, n_]] := texPower[b, n];
texE[im55[b_]] := texE[b] <> " i";
texE[(h_Symbol /; KeyExistsQ[bareNames, h])[u_]] := bareTeX[bareNames[h], u];
texE[Abs[u_]] := "\\left|{" <> texE[u] <> "}\\right|";
texE[Conjugate[u_]] := "\\overline{" <> texE[u] <> "}";
texE[Floor[u_]] := "\\left\\lfloor " <> texE[u] <> "\\right\\rfloor ";
texE[Ceiling[u_]] := "\\left\\lceil " <> texE[u] <> "\\right\\rceil ";
texE[Factorial[u_]] := paren[u, 100] <> "!";
texE[Binomial[n_, k_]] := "\\binom{" <> texE[n] <> "}{" <> texE[k] <> "}";
texE[Mod[a_, b_]] := paren[a, 30] <> "\\bmod " <> paren[b, 30];
texE[(h_Symbol /; KeyExistsQ[namedFunctions, h])[u___]] := namedFunctions[h] <> "\\left(" <> args[{u}] <> "\\right)";
texE[(h_Symbol /; KeyExistsQ[bessel, h])[n_, u_]] := bessel[h] <> "_{" <> texE[n] <> "}\\left(" <> texE[u] <> "\\right)";
texE[AiryAi[u_]] := "\\operatorname{AiryAi}\\left(" <> texE[u] <> ",0\\right)";
texE[AiryBi[u_]] := "\\operatorname{AiryBi}\\left(" <> texE[u] <> ",0\\right)";
texE[AiryAiPrime[u_]] := "\\operatorname{AiryAi}\\left(" <> texE[u] <> ",1\\right)";
texE[AiryBiPrime[u_]] := "\\operatorname{AiryBi}\\left(" <> texE[u] <> ",1\\right)";
texE[unit55[u_String]] := Module[{n = u, mu, ohm},
  mu = StringStartsQ[n, "mu"]; If[mu, n = StringDrop[n, 2]];
  ohm = StringEndsQ[n, "Ohm"]; If[ohm, n = StringDrop[n, -3]];
  If[mu, "\\mu ", ""] <> If[n == "", "", "\\mathrm{" <> n <> "}"] <> If[ohm, "\\Omega ", ""]];
texE[idx[a_, k_]] := texName[a] <> "_{" <> texE[k] <> "}";
texE[C[k_Integer]] := "c_{" <> ToString[k] <> "}";
(* f'(x), f'(g(x)) as 5.5 writes them; partial derivatives of w(x, y) *)
texE[Derivative[n_Integer][f_Symbol?isVar][u_]] := texE[f] <> "^{" <> StringRepeat["\\prime ", n] <> "}\\left(" <> texE[u] <> "\\right)";
texE[Derivative[ns__Integer][f_Symbol?isVar][us__Symbol]] /; Length[{ns}] == Length[{us}] := With[{n = Total[{ns}]},
  "\\frac{\\partial" <> If[n > 1, "^{" <> ToString[n] <> "}", ""] <> "}{" <>
    StringRiffle[MapThread[If[#1 == 0, Nothing, "\\partial " <> texE[#2] <> If[#1 > 1, "^{" <> ToString[#1] <> "}", ""]] &, {{ns}, {us}}], " "] <>
    "} " <> texE[f[us]]];
texE[(f_Symbol?isVar)[u___]] := texE[f] <> "\\left(" <> args[{u}] <> "\\right)";
texE[(r : eq | Equal | Unequal | Less | LessEqual | Greater | GreaterEqual)[a_, b_]] := Module[{x = a, y = b, h = r},
  (* 1 \leq x is written x \geq 1 *)
  If[NumericQ[x] && !NumericQ[y], {x, y} = {y, x}; h = h /. {Less -> Greater, LessEqual -> GreaterEqual, Greater -> Less, GreaterEqual -> LessEqual}];
  texE[x] <> (h /. {eq -> "=", Equal -> "=", Unequal -> "\\neq ", Less -> "<", LessEqual -> "\\leq ", Greater -> ">", GreaterEqual -> "\\geq "}) <> texE[y]];
texE[HoldPattern[Inequality[parts__]]] := StringJoin[MapIndexed[If[OddQ[#2[[1]]], texE[#1], #1 /. {Less -> "<", LessEqual -> "\\leq ", Greater -> ">", GreaterEqual -> "\\geq ", Equal -> "=", Unequal -> "\\neq "}] &, {parts}]];
texE[And[a__]] := StringRiffle[paren[#, 6] & /@ {a}, "\\wedge "];
texE[Or[a__]] := StringRiffle[paren[#, 6] & /@ {a}, "\\vee "];
texE[Not[a_]] := "\\neg " <> paren[a, 100];
texE[elem[x_, s_]] := texE[x] <> "\\in " <> texE[s];
texE[ivl[a_, b_, oa_, ob_]] := If[oa, "\\left(", "\\left["] <> texE[a] <> "," <> texE[b] <> If[ob, "\\right)", "\\right]"];
texE[fset[]] := "\\emptyset ";
texE[fset[a__]] := "\\left\\{" <> args[{a}] <> "\\right\\}";
texE[bracketed[a___]] := "\\left[" <> args[{a}] <> "\\right]";
texE[seqOut[a___]] := StringRiffle[texE /@ {a}, ", "];
texE[shown[e_]] := texE[e];
texE[rawTeX[t_String]] := t;
texE[modH[a_, m_]] := "\\left(" <> texE[a] <> "\\bmod " <> texE[m] <> "\\right)";
(* cases as 5.5 writes them (and opensw reads them back): value & if & condition; a last case
   for everything else as the condition it stands for *)
texE[HoldPattern[Piecewise[rows_, default_ : 0]]] := Module[{rs = rows},
  If[default =!= 0 && default =!= Indeterminate, AppendTo[rs, {default, And @@ (Not /@ rows[[All, 2]])}]];
  "\\left\\{ \\begin{array}{ccc} " <> StringRiffle[(texE[#[[1]]] <> " & \\text{if} & " <> texE[#[[2]]]) & /@ rs, " \\\\ "] <> " \\end{array}\\right."];
(* c0 + c1 (x - a) + c2 (x - a)^2 + .. + O((x - a)^n), in increasing powers *)
texE[s_SeriesData] := Module[{x = s[[1]], a = s[[2]], cs = s[[3]], n0 = s[[4]], n1 = s[[5]], den = s[[6]], u, out = "", term},
  u = x - a;
  Do[With[{c = cs[[i]], p = (n0 + i - 1) / den},
      If[c =!= 0,
        term = texE[If[p == 0, c, c * Inactive[Power][u, p]]];
        out = out <> If[out == "" || StringStartsQ[term, "-"], "", "+"] <> term]],
    {i, Length[cs]}];
  out <> If[out == "", "", "+"] <> "O\\left(" <> texE[Inactive[Power][u, n1 / den]] <> "\\right)"];
texE[Inactive[Power][b_, 1]] := paren[b, 31];
texE[Inactive[Power][b_, n_]] := paren[b, 31] <> "^{" <> texE[n] <> "}";
texE[contfracOut[terms_, more_]] := Module[{out = texE[Last[terms]] <> If[more == 1, "+..", ""]},
  Do[out = texE[t] <> "+\\frac{1}{" <> out <> "}", {t, Reverse[Most[terms]]}];
  out];
texE[(h : LaplaceTransform | InverseLaplaceTransform | FourierTransform | InverseFourierTransform)[f_, x_, y_, ___]] :=
  (h /. {LaplaceTransform -> "\\mathcal{L}", InverseLaplaceTransform -> "\\mathcal{L}^{-1}", FourierTransform -> "\\mathcal{F}", InverseFourierTransform -> "\\mathcal{F}^{-1}"}) <>
  "\\left(" <> args[{f, x, y}] <> "\\right)";
texE[m_?MatrixQ] := texMatrix[m];
texE[v_List] := If[v === {}, "\\left[\\right]", texMatrix[List /@ v]];
texE[x_] := ToString[TeXForm[x /. piS -> Pi]];

texMatrix[m_] := With[{d = answerDelim[]},
  "\\left" <> d <> "\\begin{matrix}" <> StringRiffle[StringRiffle[texE /@ #, " & "] & /@ m, "\\\\"] <> "\\end{matrix}\\right" <> If[d == "[", "]", ")"]];

(* the terms of a sum in the order 5.5 writes them: by powers of the variables (alphabetical),
   the highest first, the terms without a variable last; a number minus a term: 1 - x *)
orderTerms[ts_] := Module[{consts = Select[ts, FreeQ[#, _Symbol?isVar] &], others, vs},
  others = Select[ts, !FreeQ[#, _Symbol?isVar] &];
  If[Length[ts] == 2 && Length[consts] == 1 && NumberQ[First[consts]] && Im[First[consts]] == 0 && First[consts] > 0 && negativeQ[First[others]],
    Return[Join[consts, others]]];
  vs = SortBy[DeleteDuplicates[Cases[others, _Symbol?isVar, {0, Infinity}]], nameOf];
  Join[SortBy[others, Function[t, -(Quiet[Exponent[t, #]] & /@ vs) /. -Infinity -> 0]], consts]];

(* a product as 5.5 writes it: the sign first, a fraction first (\frac{1}{2}\sqrt{2}), the
   negative powers as a fraction (sec, csc as 1/cos, 1/sin) *)
denominatorQ[f_] := MatchQ[f, Power[b_, n_] /; b =!= E && negativeQ[n]];
texTimes[fs0_] := Module[{fs = fs0, c = 1, num = {}, den = {}, move, numStr, denStr, coef},
  If[fs =!= {} && NumberQ[First[fs]], c = First[fs]; fs = Rest[fs]];
  If[negativeQ[c], Return["-" <> texTimes[If[c == -1, fs, Prepend[fs, -c]]]]];
  move = c =!= 1 || Length[fs] > 1;
  Do[Which[
      denominatorQ[f], AppendTo[den, If[f[[2]] === -1, f[[1]], Power[f[[1]], -f[[2]]]]],
      move && MatchQ[f, Sec[_] | Csc[_]], AppendTo[den, f /. {Sec -> Cos, Csc -> Sin}],
      move && MatchQ[f, Power[Sec[_] | Csc[_], _Integer?Positive]], AppendTo[den, f /. {Sec -> Cos, Csc -> Sin}],
      True, AppendTo[num, f]],
    {f, fs}];
  If[Head[c] === Rational && den === {} && num =!= {},
    Return["\\frac{" <> ToString[Numerator[c]] <> "}{" <> ToString[Denominator[c]] <> "} " <> product[num]]];
  If[Head[c] === Rational, AppendTo[den, Denominator[c]]; c = Numerator[c]];
  numStr = If[c === 1, If[num === {}, "1", If[den =!= {} && Length[num] == 1, texE[First[num]], product[num]]],
    If[num === {}, texE[c], paren[c, 20] <> joiner[product[num]] <> product[num]]];
  If[den === {}, numStr, "\\frac{" <> numStr <> "}{" <> If[Length[den] == 1, texE[First[den]], product[SortBy[den, !NumberQ[#] &]]] <> "}"]];
(* the factors of a product: numbers, then the variables and their powers (2\pi k, a e^{ax}, x \sin x) *)
product[fs_] := Module[{out = ""},
  Do[With[{s = paren[f, 21]}, out = If[out == "", s, out <> joiner[s] <> s]], {f, SortBy[fs, Which[NumericQ[#], 0, MatchQ[#, _Symbol?isVar | Power[_Symbol?isVar, _]], 1, True, 2] &]}];
  out];
joiner[next_String] := If[StringMatchQ[next, RegularExpression["^[0-9-].*"]], " \\cdot ", " "];

(* a^b: \sqrt{x}, \sqrt[3]{x}, 1/x^n as a fraction, e^x, \sin^{2} x, (g(x))^2 *)
texPower[b_, n_] := Which[
  b === E, "e^{" <> texE[n] <> "}",
  n === 1/2, "\\sqrt{" <> texE[b] <> "}",
  MatchQ[n, Rational[1, _]], "\\sqrt[" <> ToString[Denominator[n]] <> "]{" <> texE[b] <> "}",
  negativeQ[n], "\\frac{1}{" <> texE[Power[b, -n]] <> "}",
  MatchQ[b, (h_Symbol /; KeyExistsQ[bareNames, h])[_]], bareTeX[bareNames[Head[b]], First[b], texE[n]],
  MatchQ[b, (_Symbol?isVar)[___] | Derivative[__][_][___]], "\\left(" <> texE[b] <> "\\right)^{" <> texE[n] <> "}",
  True, paren[b, 31] <> "^{" <> texE[n] <> "}"];

(* the marked arguments of bareTeX: \sin x where nothing could join the argument,
   \sin\left(x\right) where something follows (\sin x y would be read as sin(xy)) *)
endsArgument = "(?=\\s*($|[-+=,)}\\]&]|\\\\\\\\|\\\\,|\\\\right|\\\\end|\\\\(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|ln|arcsin|arccos|arctan|operatorname\\{arc(sinh|cosh|tanh)\\})(?![A-Za-z])))";
brackets[t_String] := StringReplace[
  StringReplace[t, RegularExpression["\\x01([^\\x01\\x02]+)\\x02" <> endsArgument] :> " $1"],
  RegularExpression["\\x01([^\\x01\\x02]+)\\x02"] :> "\\left($1\\right)"];

(* LaTeX as Scientific Word shows it; with the log base set to 10, ln x / ln 10 is \log_{10} x *)
tex[x_] := brackets[texE[If[$log10, x /. Times[Power[Log[10], -1], Log[a_], r___] :> Times[log10[a], r], x]]];

(* ---------------- the Compute menu ---------------- *)

toEqual[e_] := e /. eq -> Equal;
lastSide[eq[_, b_]] := b;
lastSide[e_] := e;
asEquation[eq[a_, b_]] := a == b;
asEquation[e_] := toEqual[e] == 0;

mainVariable[e_] := Module[{free = userVariables[e]},
  If[free === {}, unsupported["The expression has no variable"]];
  First[Join[Select[var /@ {"x", "t", "s", "z", "y"}, MemberQ[free, #] &], free]]];

texValue[x_] := tex[x];
texEq[a_, b_] := tex[a] <> "=" <> tex[b];
value[x_] := <|"kind" -> "value", "latex" -> tex[x]|>;
solutions[sols_List] := <|"kind" -> "solutions", "solutions" -> sols|>;
(* a set, as 5.5 shows it: \left\{2, 3\right\} *)
texSet[items_] := rawTeX[tex[fset @@ items]];
(* {{x -> 1, y -> 2}, ...} -> {"x=1, y=2", ...}; x \in an interval, or every solution *)
solutionTeX[v_ -> x_] := tex[v] <> If[MatchQ[x, _ivlSet | _families | _circle], "\\in " <> tex[x], "=" <> tex[x]];
ruleSolutions[rules_] := StringRiffle[solutionTeX /@ #, ", "] & /@ rules;

matrixOf[e_] := With[{m = lastSide[e]}, If[MatrixQ[m], m, unsupported["Needs a matrix"]]];
invertible[e_] := With[{m = matrixOf[e]}, If[Length[m] != Length[First[m]] || Simplify[Det[m]] === 0, unsupported["The matrix is not invertible"], m]];
numbers[e_] := With[{f = Flatten[{lastSide[e]}]}, If[f === {} || !AllTrue[f, NumericQ], unsupported["Needs a row of numbers"], f]];

(* 360 = 2^{3} \cdot 3^{2} \cdot 5 *)
factorValue[n_Integer] := rawTeX[StringRiffle[If[#[[2]] == 1, tex[#[[1]]], tex[#[[1]]] <> "^{" <> tex[#[[2]]] <> "}"] & /@ FactorInteger[n], " \\cdot "]];
(* a polynomial mod p: factored mod p; with i over the Gaussian integers, the factors monic (i(x - 2i)(x + 2i), as 5.5) *)
factorValue[modH[a_, p_Integer]] := Factor[Expand[a], Modulus -> p];
factorValue[e_] /; !FreeQ[e, Complex] && userVariables[e] =!= {} := Module[{x = mainVariable[e], fs, unit = 1, out = {}},
  fs = FactorList[Together[e], GaussianIntegers -> True];
  Do[With[{f = p[[1]], k = p[[2]]}, If[FreeQ[f, x], unit *= f^k,
      With[{lc = Coefficient[f, x, Exponent[f, x]]}, If[MemberQ[{-1, I, -I}, lc], unit *= lc^k; AppendTo[out, Expand[f / lc]^k], AppendTo[out, f^k]]]]],
    {p, fs}];
  Inactive[Times] @@ Prepend[out, unit] /. Inactive[Times][1, r__] :> Inactive[Times][r]];
factorValue[e_] := Factor[e];

(* Compute > Evaluate: the right side of an equation worked out; decimals as 5.5 (MuPAD) computes
   with them: a function or power of a number with a decimal in it becomes a decimal, and so
   does arithmetic of such numbers; pi stays (9.6 pi - 2.7 pi = 6.9 pi) *)
evaluate[e_] := Module[{r = lastSide[e]},
  If[$holdPi || !FreeQ[r, _Real], r = withDecimals[r]];
  If[assumedQ[], r = withAssumptions[r]];
  r];
withDecimals[r_] := r /. p : ((h_Symbol /; !MemberQ[{Times, Plus, Complex, Rational, List, unit55, im55, DirectedInfinity}, h])[___]) /;
    FreeQ[p, _Symbol?isVar] && !FreeQ[p, piS | _Real] :> decimal[N[p /. piS -> Pi]];
(* e^{0.5 i pi} = 1.0 i: its real part only noise; an imaginary decimal is not added to an exact number (2/3 + 1.0 i) *)
decimal[v_] := With[{c = Chop[v]}, If[Head[c] === Complex && Re[c] == 0, im55[Im[c]], c]];
(* what the assumptions say: sqrt(m^2) = m with m positive; |p + iq| with p, q real *)
withAssumptions[r_] := Module[{a = assumptions[r]},
  If[a === True, r, Refine[r, a] /. (h : Abs | Re | Im | Conjugate | Arg)[u_] /; AllTrue[userVariables[u], realQ] :> ComplexExpand[h[u]]]];

numeric[e_] := Map[If[NumericQ[#], Chop[N[#, 10], 10^-12], N[#, 10]] &, lastSide[e] /. piS -> Pi, {If[MatrixQ[lastSide[e]], 2, 0]}];

(* 5.5 rationalizes: 1/(sqrt 2 + sqrt 3) = sqrt 3 - sqrt 2 *)
rationalized[r_] := Module[{n = Numerator[r], d = Denominator[r], c},
  If[!NumericQ[r] || Head[d] =!= Plus || Length[d] != 2 || FreeQ[d, Power[_, Rational[_, 2]]], Return[r]];
  c = d[[1]] - d[[2]];
  Simplify[Expand[n c] / Expand[d c]]];
simplify55[e_] := With[{r = If[assumedQ[], Simplify[e, assumptions[e]], Simplify[e]]}, If[NumericQ[r], rationalized[r], r]];

(* Expand: a^(x - y) = a^x/a^y; sin, cos, sinh, cosh of sums and multiples by the addition
   formulas (sin 3x = 3 cos^2 x sin x - sin^3 x); a fraction as a mixed number (131/9 = 14 5/9) *)
expand55[e_?MatrixQ] := Map[expand55, e, {2}];
expand55[r_Rational] /; Abs[r] > 1 := With[{w = IntegerPart[Abs[r]]},
  rawTeX[If[r < 0, "-", ""] <> ToString[w] <> "\\frac{" <> ToString[Abs[Numerator[r]] - w Denominator[r]] <> "}{" <> ToString[Denominator[r]] <> "}"]];
expand55[e_] := Module[{r = Expand[e /. (h : Sin | Cos | Sinh | Cosh)[u_] :> TrigExpand[h[u]]]},
  r /. Power[b_, p_Plus] /; !NumericQ[p] :> Inactive[Times] @@ (Power[b, #] & /@ List @@ p)];

(* Combine: one fraction; products and powers of sin and cos as sums (sin^2 x = 1/2 - 1/2 cos 2x);
   logarithms and powers joined *)
combine55[e_?MatrixQ] := Map[combine55, e, {2}];
combine55[e_] := Module[{r = Together[e]},
  r = If[!FreeQ[r, Sin | Cos], Expand[TrigReduce[r]], Simplify[r]];
  r //. c_. Log[a_] + d_. Log[b_] :> Log[a^c b^d]];

(* Rewrite > Sin and Cos: tan, cot, sec, csc and e^(ix) in sin and cos (kept as written:
   Mathematica would make sin/cos tan again); a complex number as a + bi *)
rewriteSinCos[e_?MatrixQ] := Map[rewriteSinCos, e, {2}];
rewriteSinCos[e_] := Module[{r = e /. Power[E, u_] /; !FreeQ[u, Complex] :> ExpToTrig[E^u]},
  If[NumericQ[r], ComplexExpand[r],
    r /. {Tan[u_] :> sinI[u] / cosI[u], Cot[u_] :> cosI[u] / sinI[u], Sec[u_] :> 1 / cosI[u], Csc[u_] :> 1 / sinI[u], Sin -> sinI, Cos -> cosI}]];
(* Rewrite > Exponential: tanh x = (e^(2x) - 1)/(e^(2x) + 1) as 5.5 writes it; a power such as (x + 1)^2 stays *)
rewriteExp[e_?MatrixQ] := Map[rewriteExp, e, {2}];
rewriteExp[e_] := TrigToExp[e /. {Tanh[u_] :> (E^(2 u) - 1) / (E^(2 u) + 1), Coth[u_] :> (E^(2 u) + 1) / (E^(2 u) - 1)}];

(* ---------------- Solve ---------------- *)

(* the solutions of e (an equation, a system, A x = b) as lists of rules var -> value; unknowns:
   the variables to solve for (none given: as many as there are equations, the first ones in
   alphabetical order, as the Solve dialog offers). One equation whose unknown is in a periodic
   function or an exponent: every solution, as 5.5 gives it (families with an integer k);
   principal: 5.5's Principal Value Only, one solution *)
solveFor[e_, unknowns_, principal_] := Module[{eqs, free, vs, x, every, found, dom, cond},
  eqs = If[ListQ[e] && !MatrixQ[e], e, {e}];
  If[Length[eqs] == 1 && Head[First[eqs]] === eq && MatrixQ[First[eqs][[1]]] && MatrixQ[First[eqs][[2]]],
    If[Dimensions[First[eqs][[1]]] != Dimensions[First[eqs][[2]]], unsupported["The two sides are matrices of different sizes"]];
    eqs = MapThread[eq, Flatten /@ List @@ First[eqs]]];
  eqs = toEqual /@ eqs;
  If[MemberQ[eqs, False], Return[{}]];
  eqs = DeleteCases[eqs, True];
  eqs = If[relationQ[#] && Head[#] =!= Unequal, #, # == 0] & /@ eqs;
  free = userVariables[eqs];
  vs = If[unknowns === {}, free, unknowns];
  If[vs === {}, unsupported["The expression has no variable"]];
  (* inequalities: the real numbers that satisfy them, as intervals (as 5.5) *)
  If[!AllTrue[eqs, Head[#] === Equal &],
    If[Length[vs] != 1 || !AllTrue[eqs, MatchQ[#, _Less | _LessEqual | _Greater | _GreaterEqual | _Inequality] &],
      unsupported["Inequalities can be solved in one variable, without equations"]];
    found = Reduce[And @@ eqs, First[vs], Reals];
    Return[If[found === False, {}, {{First[vs] -> ivlSet[found, First[vs]]}}]]];
  If[unknowns === {} && Length[free] > Length[eqs], vs = Take[free, Length[eqs]]];
  cond = And @@ (assumptionOf /@ vs);
  dom = If[AllTrue[vs, realQ], Reals, Complexes];
  If[Length[eqs] == 1 && Length[vs] == 1 && !principal,
    x = First[vs];
    every = generalSolution[First[eqs], x, cond, dom];
    If[every === None && dom === Complexes, every = absCircle[First[eqs], x]];
    If[every =!= None, Return[{{x -> every}}]]];
  found = Quiet[Solve[If[cond === True, eqs, Append[eqs, cond]], vs, dom]];
  If[!ListQ[found], unsupported["Cannot solve this"]];
  found = found /. ConditionalExpression[v_, _] :> v;
  If[principal && !FreeQ[found, C], found = found /. C[_] -> 0];
  found = Select[#, MemberQ[vs, #[[1]]] &] & /@ found;
  (* x = 4 - 2y, not -2(y - 2); (-1)^(1/3) as 1/2 + 1/2 i sqrt 3 *)
  found = found /. (v_ -> s_) /; PolynomialQ[s, userVariables[s]] && userVariables[s] =!= {} :> (v -> Expand[s]);
  found = found /. (v_ -> s_) /; NumericQ[s] && !FreeQ[s, Power[-1, _Rational] | _Root] :> (v -> ComplexExpand[ToRadicals[s]]);
  found = DeleteDuplicates[found];
  If[principal && Length[found] > 1 && FreeQ[eqs, _Real], found = {First[SortBy[found, principalOrder]]}];
  found];

(* the solution 5.5's Principal Value Only gives: the smallest, the positive one of +-a (other
   variables taken as 1) *)
principalOrder[sol_] := With[{v = Quiet[N[sol[[1, 2]] /. (s_Symbol?isVar :> 1)]]},
  If[NumberQ[v], {Round[Abs[v], 10^-9], -Re[v], -Im[v]}, {Infinity, 0, 0}]];

(* every solution of eq in x as 5.5 gives it: {b + a k | k in Z} u ..., when x is in a periodic
   function or an exponent; else None. The families as MuPAD writes them: the offset of each
   within half a period of 0, two that together make one of half the period joined ({pi k} for
   sin x = 0); decimals in, decimals out *)
periodicIn[e_, x_] := !FreeQ[e, (Sin | Cos | Tan | Cot | Sec | Csc | Sinh | Cosh | Tanh | Coth)[u_] /; !FreeQ[u, x]] ||
  !FreeQ[e, Power[b_, p_] /; !FreeQ[p, x] && FreeQ[b, x]];
generalSolution[q_Equal, x_, cond_, dom_] := Module[{exact = q /. r_Real :> Rationalize[r, 0], red, terms, fams = {}, single = {}, k, names},
  If[!periodicIn[q[[1]] - q[[2]], x], Return[None]];
  red = Quiet[Reduce[If[cond === True, exact, exact && cond], x, dom]];
  If[MatchQ[red, False | _Reduce] || FreeQ[red, C], Return[None]];
  terms = If[Head[#] === Or, List @@ #, {#}] &[LogicalExpand[red]];
  If[!Catch[Do[Module[{parts = If[Head[t] === And, List @@ t, {t}], eqs, f, a, b},
      eqs = Cases[parts, Equal[x, v_] | Equal[v_, x] :> v];
      If[Length[eqs] != 1 || !AllTrue[DeleteCases[parts, Equal[x, _] | Equal[_, x]], MatchQ[#, Element[C[_], Integers]] &], Throw[False, "general"]];
      f = Expand[First[eqs]];
      If[FreeQ[f, C], AppendTo[single, f],
        a = Coefficient[f, C[1]]; b = f /. C[1] -> 0;
        If[a === 0 || !FreeQ[a, C] || Expand[f - a C[1] - b] =!= 0, Throw[False, "general"]];
        AppendTo[fams, {a, b}]]],
    {t, terms}]; True, "general"], Return[None]];
  If[fams === {}, Return[None]];
  fams = joinFamilies[fams];
  single = Select[single, Function[y, !AnyTrue[fams, inFamily[y - #[[2]], #[[1]], 0] &]]];
  If[!FreeQ[q, _Real], fams = N[fams]; single = N[single]];
  names = nameOf /@ userVariables[q];
  k = var[SelectFirst[{"k", "n", "m", "j", "l"}, !MemberQ[names, #] &]];
  families[k, fams, single]];
generalSolution[___] := None;

(* d is (an integer + frac) times a *)
inFamily[d_, a_, frac_] := With[{q = Quiet[N[d / a]]}, NumberQ[q] && Abs[Im[q]] < 10^-9 && Abs[Re[q] - frac - Round[Re[q] - frac]] < 10^-9];
(* b + a k with b's multiple of pi brought within half a period of 0 *)
shifted[a_, b_] := Module[{q = a / Pi, c = Coefficient[Expand[b], Pi]},
  If[!(Head[q] === Rational || IntegerQ[q]) || q <= 0 || !(Head[c] === Rational || IntegerQ[c]), Return[b]];
  Expand[b - Ceiling[(c - q / 2) / q] a]];
joinFamilies[fams0_] := Module[{fams = {#[[1]], shifted[#[[1]], #[[2]]]} & /@ fams0, changed = True},
  While[changed, changed = False;
    Do[If[!changed && fams[[i, 1]] === fams[[j, 1]],
        Which[
          inFamily[fams[[j, 2]] - fams[[i, 2]], fams[[i, 1]], 0], fams = Delete[fams, j]; changed = True,
          inFamily[fams[[j, 2]] - fams[[i, 2]], fams[[i, 1]], 1/2],
            With[{keep = If[Abs[N[fams[[i, 2]]]] <= Abs[N[fams[[j, 2]]]], fams[[i, 2]], fams[[j, 2]]]},
              fams[[i]] = {fams[[i, 1]] / 2, shifted[fams[[i, 1]] / 2, keep]}];
            fams = Delete[fams, j]; changed = True]],
      {i, Length[fams]}, {j, i + 1, Length[fams]}]];
  fams];
texE[families[k_, fams_, single_]] := StringRiffle[Join[
  If[single === {}, {}, {"\\left\\{ " <> args[single] <> "\\right\\}"}],
  Function[ab, Module[{ak = texE[ab[[1]] k], b = texE[ab[[2]]]}, "\\left\\{ " <>
    Which[ab[[2]] === 0, ak, !FreeQ[ab[[2]], _Real], ak <> If[StringStartsQ[b, "-"], "", "+"] <> b, True, b <> If[StringStartsQ[ak, "-"], "", "+"] <> ak] <>
    "\\mid " <> texE[k] <> "\\in \\mathbb{Z}\\right\\}"]] /@ fams], "\\cup "];

(* |a x + b| = c in the complex numbers: the circle {r e^{2 i pi t} + m | t in [0, 1]}, as 5.5 *)
absCircle[q_Equal, x_] := Module[{names = nameOf /@ userVariables[q]},
  Do[If[Head[s[[1]]] === Abs && NumericQ[s[[2]]] && Positive[s[[2]]] && PolynomialQ[s[[1, 1]], x] && Exponent[s[[1, 1]], x] == 1,
      With[{a = Coefficient[s[[1, 1]], x, 1], b = Coefficient[s[[1, 1]], x, 0]},
        If[NumericQ[a] && NumericQ[b], Return[circle[var[SelectFirst[{"t", "s", "u", "v"}, !MemberQ[names, #] &]], s[[2]] / Abs[a], -b / a], Module]]]],
    {s, {{q[[1]], q[[2]]}, {q[[2]], q[[1]]}}}];
  None];
texE[circle[t_, r_, m_]] := "\\left\\{ " <> texE[r E^(2 I Pi t)] <> If[m === 0, "", With[{s = texE[m]}, If[StringStartsQ[s, "-"], s, "+" <> s]]] <>
  "\\mid " <> texE[t] <> "\\in \\left[0,1\\right]\\right\\}";

(* the real numbers where a condition on x holds, as intervals: (1, 3), [1/2, \infty), \mathbb{R} \setminus \{2\} *)
intervalsTeX[c_, x_] := Module[{parts = If[Head[c] === Or, List @@ c, {c}]},
  If[c === True, Return["\\mathbb{R}"]];
  StringRiffle[Function[p, Which[
      MatchQ[p, HoldPattern[Inequality[_, Less | LessEqual, x, Less | LessEqual, _]]], tex[ivl[p[[1]], p[[5]], p[[2]] === Less, p[[4]] === Less]],
      MatchQ[p, (Less | LessEqual)[x, _]], tex[ivl[-Infinity, p[[2]], True, Head[p] === Less]],
      MatchQ[p, (Greater | GreaterEqual)[x, _]], tex[ivl[p[[2]], Infinity, Head[p] === Greater, True]],
      MatchQ[p, x == _], "\\left\\{" <> tex[p[[2]]] <> "\\right\\}",
      True, tex[p]]] /@ parts, "\\cup "]];
texE[ivlSet[c_, x_]] := intervalsTeX[c, x];

(* A x = b: 5.5 answers with the vector of the unknowns, in the order they are written; an
   unknown left free is a parameter, named as 5.5 names it: \hat{t}_3 for the third *)
solveAnswer[e_, unknowns_, principal_] := Module[{vs, sols},
  If[Head[e] === eq && MatrixQ[e[[1]]] && MatrixQ[e[[2]]] && unknowns === {},
    vs = Select[var /@ $names, MemberQ[userVariables[e], #] &];
    (* more unknowns than equations: the first ones in terms of the others *)
    sols = solveFor[e, Take[vs, UpTo[Length[Flatten[e[[1]]]]]], principal];
    Return[solutions[Function[s, tex[List /@ (vs /. s /. MapIndexed[If[MemberQ[s[[All, 1]], #1], Nothing, #1 -> var["that_" <> ToString[#2[[1]]]]] &, vs])]] /@ sols]]];
  sols = solveFor[e, unknowns, principal];
  (* one unknown: its values alone, as 5.5 writes them (Solution is: 1, 2), sets and families too *)
  If[sols =!= {} && AllTrue[sols, Length[#] == 1 &] && Length[Union[sols[[All, 1, 1]]]] == 1,
    solutions[tex[#[[1, 2]]] & /@ sols],
    solutions[ruleSolutions[sols]]]];

check[eq[a_, b_]] := If[MatrixQ[a] || MatrixQ[b],
  MatrixQ[a] && MatrixQ[b] && Dimensions[a] == Dimensions[b] && AllTrue[Flatten[Simplify[a - b]], # === 0 &],
  TrueQ[Simplify[a - b] == 0]];
check[b : True | False] := b;
check[_] := unsupported["Needs an equals sign"];

extrema[e_] := Module[{f = lastSide[e], x}, x = mainVariable[f];
  ruleSolutions[Join[#, {var["f"] -> Simplify[f /. #]}] & /@ Solve[D[f, x] == 0, x]]];

(* real numerical solutions of one equation (polynomials: all roots; others: one, the one
   nearest 0, as 5.5), or of a system; rows x \in (a, b) (as 5.5 writes them) give the interval *)
numericSolve[e_, unknowns_] := Module[{rows = Flatten[{e}], ranges, eqs, f, x, roots = {}},
  ranges = Cases[rows, elem[v_, s_ivl] :> (v -> s)];
  eqs = asEquation /@ DeleteCases[rows, _elem];
  If[Length[eqs] > 1 || ranges =!= {}, Return[numericSolveIn[eqs, ranges, unknowns]]];
  f = eqs[[1, 1]] - eqs[[1, 2]];
  x = If[unknowns === {}, mainVariable[f], First[unknowns]];
  If[PolynomialQ[f, x],
    roots = x /. Quiet[NSolve[f == 0, x, WorkingPrecision -> 20]],
    Do[With[{r = Quiet[x /. FindRoot[Evaluate[f], Evaluate[{x, g}], WorkingPrecision -> 20]]},
        If[NumberQ[r] && Abs[f /. x -> r] < 10^-8 && AllTrue[roots, Abs[r - #] > 10^-8 &], AppendTo[roots, r]]],
      {g, {-10, -3, -1, -1/2, 0, 1/2, 1, 3, 10}}];
    roots = Take[SortBy[roots, Abs], UpTo[1]]];
  {x -> If[Abs[Im[#]] < 10^-12 Max[1, Abs[#]], N[Re[#], 10], N[#, 10]]} & /@ roots];
numericSolveIn[eqs_, ranges_, unknowns_] := Module[{fs = #[[1]] - #[[2]] & /@ eqs, xs, found = {}, keep},
  xs = If[unknowns === {}, userVariables[fs], unknowns];
  If[Length[fs] != Length[xs], unsupported["Needs as many equations as unknowns"]];
  keep[sol_] := With[{s = If[Abs[Im[#]] < 10^-12, N[Re[#], 10], N[#, 10]] & /@ sol},
    If[AllTrue[Transpose[{xs, s}], !KeyExistsQ[Association[ranges], #[[1]]] || inIvl[#[[2]], #[[1]] /. ranges] &] &&
        AllTrue[found, Max[Abs[s - #]] > 10^-8 &], AppendTo[found, s]]];
  If[Length[xs] == 1 && KeyExistsQ[Association[ranges], First[xs]],
    (* one equation: where it changes sign in the interval *)
    With[{x = First[xs], r = First[xs] /. ranges, f = First[fs]}, Module[{pts, vals},
      pts = Table[r[[1]] + (r[[2]] - r[[1]]) k / 400, {k, 0, 400}];
      vals = Quiet[Re[N[f /. x -> #]]] & /@ pts;
      Do[If[NumberQ[vals[[i]]] && NumberQ[vals[[i + 1]]] && (vals[[i]] == 0 || vals[[i]] vals[[i + 1]] < 0),
          keep[{If[vals[[i]] == 0, pts[[i]], x /. Quiet[FindRoot[Evaluate[f], Evaluate[{x, pts[[i]], pts[[i + 1]]}], Method -> "Brent", WorkingPrecision -> 20]]]}]],
        {i, 400}]]],
    If[AllTrue[fs, PolynomialQ[#, xs] &] && ranges === {},
      Scan[If[Length[#] == Length[xs], keep[xs /. #]] &, Quiet[NSolve[Thread[fs == 0], xs, WorkingPrecision -> 20]]],
      Do[With[{r = Quiet[Check[xs /. FindRoot[Evaluate[fs], Evaluate[Transpose[{xs, start}]], WorkingPrecision -> 20], $Failed]]},
          If[ListQ[r], keep[r]]; If[ranges =!= {} && found =!= {}, Break[]]],
        {start, Tuples[If[KeyExistsQ[Association[ranges], #], With[{r = # /. ranges}, r[[1]] + (r[[2]] - r[[1]]) {4, 1, 3, 5, 7} / 8], {-3, -1, 1, 3}] & /@ xs]}]]];
  Thread[xs -> #] & /@ found];
inIvl[v_, ivl[a_, b_, oa_, ob_]] := NumberQ[v] && Im[v] == 0 && If[oa, v > a, v >= a] && If[ob, v < b, v <= b];

integerSolve[e_] := Module[{eqs = asEquation /@ Flatten[{e}], vs}, vs = userVariables[eqs];
  ruleSolutions[Solve[eqs, vs, Integers] /. ConditionalExpression[v_, _] :> v]];

(* 5.5's Implicit Differentiation: both sides differentiated in the differentiation variable (x when
   not given); every other letter is a function of it (b too, giving b'), the derivatives written
   with primes (5.5's help: x y + sin x = y gives cos x + y + x y' = y'; y' = .. gives y'' = ..) *)
implicitDiff[e_, v_ : None] := Module[{q = asEquation[e], x = If[v === None, var["x"], v], others, base, ord, side},
  others = DeleteCases[userVariables[q], x];
  If[others === {}, unsupported["Needs an expression in " <> tex[x] <> " and another letter, e.g. y"]];
  base[s_] := var[StringDelete[nameOf[s], "'"]];
  ord[s_] := StringCount[nameOf[s], "'"];
  side = Expand[D[# /. ((# -> If[ord[#] == 0, base[#][x], Derivative[ord[#]][base[#]][x]]) & /@ others), x]] /.
    {Derivative[k_][f_?isVar][x] :> var[nameOf[f] <> StringRepeat["'", k]], (f_?isVar)[x] :> f} &;
  texEq[side[q[[1]]], side[q[[2]]]]];

(* the unknown of an ODE is a function the user wrote, y(x) *)
solveODE[e_] := Module[{q = asEquation[e], fs, fx},
  fs = DeleteDuplicates[Cases[q, (h_Symbol /; isVar[h])[_Symbol?isVar], {0, Infinity}]];
  If[fs === {}, unsupported["Needs an unknown function, e.g. y(x)"]];
  fx = First[SortBy[fs, ToString]];
  texEq @@@ Flatten[DSolve[q, fx, fx[[1]]], 1]];

(* MathJSON of an ODE as typed (y'' + y = 0, y'(x) = 2y(x), dy/dx = y) -> MathJSON in which
   the unknown is the function y(x) and its derivatives are {"D", {"y", "x"}, "x", ...}
   (the same as ode_form in opensw_compute.py) *)
odeForm[j_, known_ : {}, default_ : None] := Module[{names = known, v = None, scan, fix},
  scan[n_List] := If[n =!= {},
    If[n[[1]] === "Prime" && StringQ[n[[2]]], AppendTo[names, n[[2]]]];
    If[n[[1]] === "Apply" && startsWith[n[[2]], "Derivative"],
      AppendTo[names, n[[2, 2]]]; If[v === None, v = n[[3]]]];
    If[n[[1]] === "D" && startsWith[n[[2]], "Function"],
      With[{body = n[[2, 2]]}, If[startsWith[body, "Block"] && StringQ[body[[2]]], AppendTo[names, body[[2]]]]];
      If[v === None, v = n[[3]]]];
    scan /@ Rest[n]];
  scan[_] := Null;
  scan[j];
  If[names === {}, names = {"y"}];
  (* the variable: the one of dy/dt, else default, else x (t when x is an unknown: x' = y) *)
  If[v === None, v = Which[default =!= None, default, MemberQ[names, "x"], "t", True, "x"]];
  fix[n_String] := If[MemberQ[names, n], {n, v}, n];
  fix[n_List] := Which[
    n === {}, n,
    n[[1]] === "Prime" && MemberQ[names, n[[2]]], Join[{"D", {n[[2]], v}}, ConstantArray[v, If[Length[n] > 2, n[[3]], 1]]],
    n[[1]] === "Apply" && startsWith[n[[2]], "Derivative"],
      Join[{"D", {n[[2, 2]], n[[3]]}}, ConstantArray[n[[3]], If[Length[n[[2]]] > 2, n[[2, 3]], 1]]],
    n[[1]] === "D" && startsWith[n[[2]], "Function"],
      With[{body = n[[2, 2]]}, Join[{"D", {If[startsWith[body, "Block"], body[[2]], body], n[[3]]}}, Drop[n, 2]]],
    StringQ[n[[1]]] && MemberQ[names, n[[1]]], n,
    True, Prepend[fix /@ Rest[n], n[[1]]]];
  fix[n_] := n;
  fix[j]];

vectorOf[e_] := With[{v = lastSide[e]}, Which[
  MatrixQ[v] && (Length[v] == 1 || Length[First[v]] == 1), Flatten[v],
  VectorQ[v], v,
  True, unsupported["Needs a vector (a one-row or one-column matrix)"]]];

vectorOp[op_, e_, xs_] := Module[{F, f = lastSide[e]}, Switch[op,
  "gradient", D[f, {xs}],
  "laplacian", Simplify[Total[D[f, {#, 2}] & /@ xs]],
  "hessian", D[f, {xs, 2}],
  "wronskian", With[{fs = vectorOf[e]}, Simplify[Det[Table[D[fs, {mainVariable[fs], k}], {k, 0, Length[fs] - 1}]]]],
  "divergence", F = vectorOf[e];
    If[Length[F] != Length[xs], unsupported["The vector needs " <> ToString[Length[xs]] <> " components (as many as the basis variables)"]];
    Total[MapThread[D, {F, xs}]],
  "curl", F = vectorOf[e]; If[Length[F] != 3 || Length[xs] != 3, unsupported["Curl is three-dimensional only"]]; Curl[F, xs],
  "jacobian", D[vectorOf[e], {xs}],
  "potential", potential[vectorOf[e], xs],
  "vectorpotential", vectorPotential[vectorOf[e], xs]]];
vectorOps = {"gradient", "divergence", "curl", "laplacian", "hessian", "jacobian", "wronskian", "potential", "vectorpotential"};

(* a scalar potential phi with grad phi = F (F must have curl 0) *)
potential[F_, xs_] := Module[{phi = 0},
  If[Length[F] != Length[xs], unsupported["The vector needs " <> ToString[Length[xs]] <> " components (as many as the basis variables)"]];
  Do[If[Simplify[D[F[[i]], xs[[j]]] - D[F[[j]], xs[[i]]]] =!= 0, unsupported["This vector field has no scalar potential (its curl is not 0)"]],
    {i, Length[xs]}, {j, i + 1, Length[xs]}];
  Do[phi += Integrate[Simplify[F[[i]] - D[phi, xs[[i]]]], xs[[i]]], {i, Length[xs]}];
  Simplify[phi]];

(* A with curl A = F (F must have divergence 0), A_z = 0 *)
vectorPotential[F_, xs_] := Module[{x, y, z, t, ax, ay},
  If[Length[xs] != 3 || Length[F] != 3, unsupported["Vector potentials are three-dimensional only"]];
  {x, y, z} = xs;
  If[Simplify[Total[MapThread[D, {F, xs}]]] =!= 0, unsupported["This vector field has no vector potential (its divergence is not 0)"]];
  ax = Integrate[F[[2]] /. z -> t, {t, 0, z}] - Integrate[F[[3]] /. {y -> t, z -> 0}, {t, 0, y}];
  ay = -Integrate[F[[1]] /. z -> t, {t, 0, z}];
  {Simplify[ax], Simplify[ay], 0}];


(* ---------------- operations that ask for more (5.5 asks in a dialog) ---------------- *)

(* a parameter: a formula, or a word written 'word' *)
param[p_String /; StringStartsQ[p, "'"]] := StringTrim[p, "'"];
param[p_] := expr[p];
wholeNumber[n_] := If[IntegerQ[n], n, unsupported["Must be an integer"]];

(* the integral the cursor is in, not worked out: {integrand, x, {a, b} or None} *)
integralParts[{"Equal", _, r_}] := integralParts[r];
integralParts[{"Integrate", f_, lim_}] := Module[{body, v, l},
  {body, v} = functionBody[f];
  l = applyDefs[limits[lim]];
  Which[
    ListQ[l] && Length[l] == 3, {applyDefs[body], l[[1]], l[[2 ;; 3]]},
    isVar[l], {applyDefs[body], l, None},
    True, unsupported["Put the cursor in an integral"]]];
integralParts[_] := unsupported["Put the cursor in an integral"];

heldIntegral[f_, x_, None] := HoldForm[Integrate[f, x]];
heldIntegral[f_, x_, {a_, b_}] := HoldForm[Integrate[f, {x, a, b}]];

(* Calculus > Integrate by Parts: u is the part to differentiate; the integral is left
   as 5.5 shows it: u v - integral of v u' *)
byParts[j_, u_] := Module[{f, x, ab, v, rest, uv},
  {f, x, ab} = integralParts[j];
  v = Integrate[Cancel[f / u], x];
  If[!FreeQ[v, Integrate], unsupported["The rest cannot be integrated; try another part to differentiate"]];
  rest = Simplify[v D[u, x]];
  uv = u v;
  rawTeX[If[ab === None, tex[uv], tex[(uv /. x -> ab[[2]]) - (uv /. x -> ab[[1]])]] <> "-" <> tex[heldIntegral[rest, x, ab]]]];

(* Calculus > Change Variable: q is u = g(x) (new variable u) or x = h(u) *)
changeVariable[j_, q_] := Module[{f, x, ab, lhs, rhs, u, h, sols, g, newAb},
  {f, x, ab} = integralParts[j];
  If[Head[q] =!= eq, unsupported["Write it as u = g(x) or x = h(u)"]];
  {lhs, rhs} = List @@ q;
  Which[
    lhs === x, (* x = h(u) *)
      u = Complement[userVariables[rhs], {x}];
      If[u === {}, unsupported["The right side needs the new variable"]];
      u = First[u];
      newAb = If[ab === None, None, Map[Function[b, principal[u /. Quiet[Solve[rhs == b, u]]]], ab]];
      g = (f /. x -> rhs) D[rhs, u],
    isVar[lhs] && !FreeQ[rhs, x], (* u = g(x) *)
      u = lhs;
      sols = x /. Solve[u == rhs, x];
      If[!ListQ[sols] || sols === {}, unsupported["Cannot solve for x"]];
      (* the branch that gives back the bounds *)
      h = SelectFirst[sols, Function[cand, ab === None || AllTrue[ab, Function[bd, TrueQ[Simplify[(cand /. u -> (rhs /. x -> bd)) == bd]]]]], Last[sols]];
      g = (f /. x -> h) D[h, u];
      newAb = If[ab === None, None, Simplify[rhs /. x -> #] & /@ ab],
    True, unsupported["The left side must be the new variable u (u = g(x)) or the variable of integration (x = h(u))"]];
  (* simplified knowing u stays between the new bounds: sqrt(1 - sin^2 u) = cos u on [0, pi/2] *)
  heldIntegral[If[ab === None || !AllTrue[N[newAb], NumericQ], Simplify[g], Simplify[g, Min[newAb] <= u <= Max[newAb]]], u, newAb]];
(* of the values u can take (x = sin u gives u = 2 pi k, pi + 2 pi k ...) the one nearest 0 *)
principal[{}] := unsupported["The limits cannot be changed over"];
principal[us_List] := First[SortBy[Normal[us] /. C[_] -> 0, If[NumericQ[#], Abs[N[#]], Infinity] &]];
principal[_] := unsupported["The limits cannot be changed over"];

(* Calculus > Approximate Integral: left, midpoint, right, trapezoid or Simpson, n subintervals *)
approxIntegral[j_, method_, n0_] := Module[{f, x, ab, a, b, h, F, n = wholeNumber[n0], r},
  {f, x, ab} = integralParts[j];
  If[ab === None, unsupported["Needs an integral with limits"]];
  If[n < 1 || (method == "simpson" && OddQ[n]), unsupported[If[method == "simpson", "Simpson's rule needs a positive even number of subintervals", "The number of subintervals must be a positive integer"]]];
  {a, b} = ab;
  h = (b - a) / n;
  F[t_] := f /. x -> t;
  r = Switch[method,
    "left", h Total[Table[F[a + k h], {k, 0, n - 1}]],
    "right", h Total[Table[F[a + k h], {k, 1, n}]],
    "midpoint", h Total[Table[F[a + (k + 1/2) h], {k, 0, n - 1}]],
    "trapezoid", h / 2 (F[a] + 2 Total[Table[F[a + k h], {k, 1, n - 1}]] + F[b]),
    "simpson", h / 3 (F[a] + F[b] + Total[Table[If[OddQ[k], 4, 2] F[a + k h], {k, 1, n - 1}]]),
    _, unsupported[method]];
  N[r, 10]];

(* Calculus > Iterate: x0, f(x0), f(f(x0)), ... (count steps), as a column *)
iterate[j_, start_, count0_] := Module[{f = lastSide[expr[j]], x, count = wholeNumber[count0]},
  x = mainVariable[f];
  If[count < 1 || count > 1000, unsupported["The number of steps must be 1 to 1000"]];
  List /@ NestList[(f /. x -> #) &, start, count]];

(* the entries of a list or matrix (MathJSON), row by row; anything else is one item *)
itemsJson[{"Matrix", m_, ___}] := itemsJson[m];
itemsJson[{"List", rows___}] := Join @@ (If[startsWith[#, "List"], itemsJson[#], {#}] & /@ {rows});
itemsJson[j_] := {j};

(* a_{n+1} and a_n -> a(n+1), a(n): the unknown sequence written as a function *)
sequenceForm[j_String] := With[{m = StringCases[j, RegularExpression["^([A-Za-z])_(\\w+)$"] :> {"$1", "$2"}]},
  If[m === {}, j, {m[[1, 1]], If[StringMatchQ[m[[1, 2]], DigitCharacter ..], FromDigits[m[[1, 2]]], m[[1, 2]]]}]];
sequenceForm[{"Subscript", a_String, i_}] /; StringLength[a] == 1 := {a, sequenceForm[i]};
sequenceForm[j_List] := sequenceForm /@ j;
sequenceForm[j_] := j;

(* Solve > Recursion: a recurrence (a_{n+1} = 2a_n + 1), with starting values (a_0 = 1) *)
solveRecursion[items_] := Module[{qs = asEquation /@ items, apps, general, rec, a, n, sol},
  apps[q_] := Cases[q, (h_Symbol /; isVar[h])[_], {0, Infinity}];
  general = Select[qs, AnyTrue[apps[#], !FreeQ[First[#], _Symbol?isVar] &] &];
  If[general === {}, unsupported["Needs a recurrence, for example a_{n+1} = 2a_n + 1"]];
  rec = First[general];
  a = Head[First[apps[rec]]];
  n = First[userVariables[First /@ apps[rec]]];
  sol = Quiet[RSolve[Join[{rec}, Select[DeleteCases[qs, rec], MatchQ[#, Equal[a[_Integer], _]] &]], a[n], n]];
  If[!MatchQ[sol, {{_Rule, ___}, ___}], unsupported["This recursion cannot be solved"]];
  texEq[a[n], Simplify[a[n] /. First[sol]]]];

(* Simplex (linear programming); the variables are taken as nonnegative, as in 5.5 *)
lpParts[items_] := Module[{obj, cons, vs},
  If[Length[items] < 2, unsupported["Put the objective in the first row and one constraint in each row below"]];
  obj = First[items]; cons = toEqual /@ Rest[items];
  If[!AllTrue[cons, MatchQ[#, _LessEqual | _GreaterEqual | _Less | _Greater | _Equal] &], unsupported["Constraints must use ≤, ≥ or ="]];
  vs = userVariables[{obj, cons}];
  {obj, cons, vs}];
lpRegion[cons_, vs_] := And @@ Join[cons, Thread[vs >= 0]];

lpOptimum[items_, max_] := Module[{obj, cons, vs, r},
  {obj, cons, vs} = lpParts[items];
  r = Quiet[If[max, Maximize, Minimize][{obj, lpRegion[cons, vs]}, vs]];
  Which[
    r[[1]] === If[max, -Infinity, Infinity], unsupported["The constraints have no common solution (infeasible)"],
    r[[1]] === If[max, Infinity, -Infinity], unsupported[If[max, "No maximum", "No minimum"]]];
  StringRiffle[Append[(tex[#] <> "=" <> tex[# /. r[[2]]]) & /@ vs, If[max, "\\text{maximum}", "\\text{minimum}"] <> "=" <> tex[r[[1]]]], ", "]];

lpFeasible[items_] := Module[{obj, cons, vs}, {obj, cons, vs} = lpParts[items];
  Quiet[FindInstance[lpRegion[cons, vs], vs, Reals]] =!= {}];

(* Simplex > Standardize: every constraint as  (linear part) <= number *)
lpStandard[items_] := Module[{obj, cons, vs, out},
  {obj, cons, vs} = lpParts[items];
  out = {obj};
  Do[Module[{d = Expand[c[[1]] - c[[2]]], k, lin},
      k = d /. Thread[vs -> 0];
      lin = d - k;
      Switch[Head[c],
        GreaterEqual | Greater, AppendTo[out, -lin <= k],
        Equal, out = Join[out, {lin <= -k, -lin <= k}],
        _, AppendTo[out, lin <= -k]]],
    {c, cons}];
  out];

(* Simplex > Dual: maximize c.x with A x <= b, x >= 0  ->  minimize b.y with A^T y >= c, y >= 0 *)
lpDual[items_] := Module[{std = lpStandard[items], obj, cons, vs, A, b, c, ys},
  obj = First[std]; cons = Rest[std];
  vs = userVariables[std];
  A = Table[Coefficient[Expand[con[[1]]], v], {con, cons}, {v, vs}];
  b = cons[[All, 2]];
  c = Coefficient[Expand[obj], #] & /@ vs;
  ys = var["y_" <> ToString[#]] & /@ Range[Length[cons]];
  Join[{b . ys}, Table[A[[All, k]] . ys >= c[[k]], {k, Length[vs]}]]];

(* several formulas (constraints, equations ...) as one column, as 5.5 writes them *)
column[items_] := "\\begin{pmatrix}" <> StringRiffle[tex /@ items, "\\\\"] <> "\\end{pmatrix}";


(* ---------------- plots: values on a grid ---------------- *)

noOtherVariables[es_, vs_] := With[{free = Complement[userVariables[es], vs]},
  If[free =!= {}, unsupported["Variables without a value: " <> StringRiffle[nameOf /@ free, ", "]]]];
(* a real number, or null where there is none (outside the domain, complex, infinite) *)
realOrNone[v_] := With[{z = Quiet[N[v]]}, If[NumericQ[z] && Abs[Im[z]] < 10^-12 Max[1, Abs[Re[z]]], Re[z], Null]];
toNumber[x_String] := number[x];
toNumber[x_] := x;
grid[a_, b_, n_] := With[{lo = toNumber[a], hi = toNumber[b], k = toNumber[n]}, N[Table[lo + (hi - lo) i / k, {i, 0, k}]]];
(* k + 1 points from t0 to t1 (just t0 when k is 0) *)
steps[t0_, t1_, k_] := If[k == 0, {t0}, Table[t0 + i (t1 - t0) / k, {i, 0, k}]];

plotPoints[p_] := Module[{e, v = var[Replace[Lookup[p, "var", "x"], Null -> "x"]], xs},
  If[numericSymbolQ[v], v = var["opensw_plot"]]; (* y of Solve ODE > Numeric, plotted in y *)
  e = applyDefs[numericFunctions[build[p["expr"]], v]];
  noOtherVariables[e, {v}];
  xs = grid[p["a"], p["b"], Lookup[p, "n", 100]];
  <|"kind" -> "points", "x" -> xs, "y" -> (realOrNone[numericValues[e /. v -> #]] & /@ xs)|>];

plotGrid[p_] := Module[{e = expr[p["expr"]], xv, yv, xs, ys},
  {xv, yv} = var /@ Replace[Lookup[p, "vars", {"x", "y"}], Null -> {"x", "y"}];
  noOtherVariables[e, {xv, yv}];
  xs = grid[p["a"], p["b"], Lookup[p, "n", 24]];
  ys = grid[p["c"], p["d"], Lookup[p, "m", 24]];
  <|"kind" -> "grid", "x" -> xs, "y" -> ys, "z" -> Table[realOrNone[e /. {xv -> x, yv -> y}], {x, xs}, {y, ys}]|>];

(* values of each formula on the grid of the variables (the last one running fastest);
   grad: the partial derivatives of the one formula; complex: z = x + iy, giving the real
   and imaginary parts (conformal plots) *)
plotValues[p_] := Module[{vs = var /@ p["vars"], es, c = Lookup[p, "complex", Null], axes, pts},
  es = applyDefs[numericFunctions[build[#], vs[[1]]]] & /@ p["exprs"];
  If[TrueQ[Lookup[p, "grad", False]], es = D[First[es], #] & /@ vs];
  If[StringQ[c], es = {First[es] /. var[c] -> vs[[1]] + I vs[[2]]}];
  noOtherVariables[es, vs];
  axes = MapThread[grid[#1[[1]], #1[[2]], #2] &, {p["ranges"], p["ns"]}];
  pts = Thread[vs -> #] & /@ Tuples[axes];
  <|"kind" -> "values", "axes" -> axes, "values" -> If[StringQ[c],
    With[{zs = Quiet[N[First[es] /. #]] & /@ pts}, {If[NumericQ[#], Re[#], Null] & /@ zs, If[NumericQ[#], Im[#], Null] & /@ zs}],
    Function[e, realOrNone[numericValues[e /. #]] & /@ pts] /@ es]|>];

(* the names written in a MathJSON formula (not its heads or words) *)
jsonNames[j_List] := Union @@ Prepend[jsonNames /@ Rest[j], {}];
jsonNames[s_String] := If[StringStartsQ[s, "'"], {}, {s}];
jsonNames[_] := {};

(* Equations of any order (y' = f(x, y), y'' + y = 0, or a system) and their initial values
   ({name, x0, value(, order of the derivative)}: y(0) = 1, y'(0) = 0), as the SymPy engine reads
   them: an equation of order n in y needs y(x0), ..., y^(n-1)(x0). The variable is the one the
   derivatives are taken in (dy/dt), else the one other name in the equations (y' = sin xy),
   else x (t when x is an unknown, as 5.5).
   -> <|"eqs" -> equations and initial values (for NDSolve), "funcs", "t", "x0", "shown"|> *)
odeSystem[eqsJ_, initsJ_] := Module[{names, found, eqs, ds, funcs, order = <||>, t, inits, need, x0},
  names = DeleteDuplicates[First /@ initsJ];
  found = Complement[jsonNames[Prepend[eqsJ, "List"]], names, Keys[constants]];
  eqs = expr /@ Rest[odeForm[Prepend[eqsJ, "List"], names, If[Length[found] == 1, First[found], None]]];
  ds = Function[e, If[Head[e] =!= eq, unsupported["The equation must be y' = f(x, y)"]];
    With[{d = DeleteDuplicates[Cases[e, Derivative[k_][f_][s_] :> {k, f, s}, {0, Infinity}]]}, Module[{top},
      If[d === {}, unsupported["The equation needs a derivative, e.g. y'"]];
      top = Select[d, #[[1]] == Max[d[[All, 1]]] &];
      If[Length[top] > 1 || Length[DeleteDuplicates[d[[All, 3]]]] > 1, unsupported["Each equation needs one highest derivative, e.g. y'' = -y"]];
      First[top]]]] /@ eqs;
  funcs = ds[[All, 2]];
  If[!DuplicateFreeQ[funcs], unsupported["Each unknown function needs one equation and one initial value"]];
  Scan[(order[#[[2]]] = #[[1]]) &, ds];
  funcs = SortBy[funcs, nameOf];
  t = ds[[1, 3]];
  inits = {var[#[[1]]], If[Length[#] > 3, #[[4]], 0], expr[#[[2]]], expr[#[[3]]]} & /@ initsJ;
  need = Flatten[Table[{f, k}, {f, funcs}, {k, 0, order[f] - 1}], 1];
  If[Sort[need] =!= Sort[inits[[All, 1 ;; 2]]],
    unsupported["Each unknown function needs one equation and its initial values: " <> StringRiffle[nameOf[#[[1]]] <> StringRepeat["'", #[[2]]] <> "(x0)" & /@ need, ", "]]];
  x0 = N[inits[[1, 3]]];
  If[!AllTrue[N[inits[[All, 3]]], # == x0 &], unsupported["The initial values must be at the same point"]];
  noOtherVariables[eqs /. Derivative[__][f_][u_] :> f[u], {t}]; (* y only in y' is a function too *)
  <|"eqs" -> Join[toEqual /@ eqs, If[#[[2]] == 0, #[[1]][x0], Derivative[#[[2]]][#[[1]]][x0]] == N[#[[4]]] & /@ inits],
    "funcs" -> funcs, "t" -> t, "x0" -> x0,
    "shown" -> StringRiffle[Join[tex /@ eqs, tex[eq[If[#[[2]] == 0, #[[1]][#[[3]]], Derivative[#[[2]]][#[[1]]][#[[3]]]], #[[4]]]] & /@ inits], ", "]|>];

(* NDSolve over [lo, hi]: the functions' values there (InterpolatingFunctions, over the part of
   [lo, hi] they reach: not past a point where the solution grows without bound) *)
ndsolve[sys_, lo_, hi_] := With[{sol = Quiet[NDSolve[sys["eqs"], sys["funcs"], {sys["t"], lo, hi},
    PrecisionGoal -> 10, AccuracyGoal -> 12, MaxSteps -> 200000]]},
  If[!MatchQ[sol, {{__Rule}, ___}], unsupported["No numerical solution found"]];
  sys["funcs"] /. First[sol]];

(* Plot 2D > ODE: the solution at n + 1 points from a to b (the same points as the SymPy engine) *)
odePoints[p_] := Module[{sys, x0, a = N[toNumber[p["a"]]], b = N[toNumber[p["b"]]], n = toNumber[Lookup[p, "n", 200]], lo, back, fwd, ts, gs},
  sys = odeSystem[p["eqs"], p["inits"]];
  x0 = sys["x0"];
  lo = If[b > a, Max[0, Min[n, Round[n (x0 - a) / (b - a)]]], 0];
  back = If[x0 > a, Reverse[steps[x0, a, lo]], {}];
  fwd = If[x0 < b, steps[x0, b, n - lo], {x0}];
  ts = If[back === {}, fwd, Join[Most[back], fwd]];
  gs = ndsolve[sys, Min[a, x0], Max[b, x0]];
  <|"kind" -> "ode", "x" -> ts, "var" -> nameOf[sys["t"]], "y" -> Association[MapThread[Function[{f, g},
    nameOf[f] -> (If[g["Domain"][[1, 1]] <= # <= g["Domain"][[1, 2]], realOrNone[g[#]], Null] & /@ ts)], {sys["funcs"], gs}]]|>];

(* Solve ODE > Numeric: the unknowns become functions (5.5's answer: Functions defined: y) that
   later computations evaluate and plot. $problems: id -> the system, the interval solved so far
   and its solutions; $numeric: name -> {id, its place among the unknowns} *)
numericODE[eqsJ_, initsJ_] := Module[{sys, id = Length[$problems] + 1, names},
  KeyDropFrom[$numeric, First /@ initsJ]; (* defined again: y' is the new y's derivative *)
  sys = odeSystem[eqsJ, initsJ];
  names = nameOf /@ sys["funcs"];
  KeyDropFrom[$defs, names];
  $problems[id] = Join[sys, <|"lo" -> sys["x0"], "hi" -> sys["x0"], "gs" -> None|>];
  MapIndexed[($numeric[#1] = {id, First[#2]}) &, names];
  <|"kind" -> "solutions", "label" -> ", Functions defined: ", "solutions" -> {StringRiffle[names, ","]}|>];

(* the value of y of Solve ODE > Numeric at t: solved again over a wider interval when t is outside
   the one solved so far (twice as wide each time, so values asked in order are quick) *)
numericAt[name_, t0_] := Module[{t = N[t0], id, k, pr, lo, hi, g},
  {id, k} = $numeric[name];
  pr = $problems[id];
  If[!(Im[t] == 0), Return[Indeterminate]];
  If[pr["gs"] === None || t < pr["lo"] || t > pr["hi"],
    lo = Min[pr["lo"], t, If[t < pr["lo"], pr["lo"] - (pr["hi"] - pr["lo"]), pr["lo"]]];
    hi = Max[pr["hi"], t, If[t > pr["hi"], pr["hi"] + (pr["hi"] - pr["lo"]), pr["hi"]]];
    If[hi == lo, hi = lo + 1];
    pr = Join[pr, <|"lo" -> lo, "hi" -> hi, "gs" -> ndsolve[pr, lo, hi]|>];
    $problems[id] = pr];
  g = pr["gs"][[k]];
  If[g["Domain"][[1, 1]] <= t <= g["Domain"][[1, 2]], g[t], Indeterminate]];
numericSymbolQ[s_Symbol] := isVar[s] && KeyExistsQ[$numeric, nameOf[s]];
numericSymbolQ[_] := False;
(* y of Solve ODE > Numeric written alone in a formula to plot: the function of the plot's variable *)
numericFunctions[e_, v_] := Replace[e, s_?numericSymbolQ :> s[v], {0, Infinity}, Heads -> False];
(* ... and its values once the plot's variable is a number *)
numericValues[e_] := If[$numeric === <||>, e, e /. (s_Symbol?numericSymbolQ)[t_?NumericQ] :> numericAt[nameOf[s], t]];

(* ---------------- Tools > Exam Builder ---------------- *)

(* rand(), rand(n) in 0..n-1, rand(n, m) in n..m, rand({set}); randmat(rows, cols, type, range)
   with type 1 any, 2 symmetric, 3 antisymmetric, 4 unimodular (as 5.5's Exam Builder) *)
pick[setOf[l_]] := RandomChoice[l];
pick[l_List] := RandomChoice[Flatten[l]];
pick[s_fset] := RandomChoice[List @@ s]; (* a set kept in a variable: s = {2, 3, 5} *)
pick[rangeOf[{lo_, hi_, ___}]] := RandomInteger[{lo, hi}];
pick[rangeOf[{n_}]] := pick[n];
pick[n_] := If[IntegerQ[n] && n >= 1, RandomInteger[n - 1], unsupported["The n in rand(n) must be a positive integer"]];
examRandom["rand", {}] := RandomInteger[10^12 - 1];
examRandom["rand", {r_}] := pick[r];
examRandom["rand", {r1_, r2_, ___}] := pick[rangeOf[{r1, r2}]];
examRandom["randmat", {rows_, cols_, typ_, r_ : rangeOf[{10}], ___}] := Module[{m, low, up},
  If[MemberQ[{2, 3, 4}, typ] && rows != cols, unsupported["Symmetric, antisymmetric and unimodular matrices must be square"]];
  m = ConstantArray[0, {rows, cols}];
  Do[If[typ == 1 || (typ == 2 && j >= i) || (typ == 3 && j > i),
      m[[i, j]] = pick[r];
      If[typ == 2, m[[j, i]] = m[[i, j]]];
      If[typ == 3, m[[j, i]] = -m[[i, j]]]],
    {i, rows}, {j, cols}];
  If[typ == 4, (* lower times upper triangular with 1 on the diagonal: determinant 1 *)
    low = IdentityMatrix[rows]; up = IdentityMatrix[rows];
    Do[low[[i, j]] = pick[r]; up[[j, i]] = pick[r], {i, rows}, {j, i - 1}];
    m = low . up];
  m];
examRandom[_, _] := unsupported["rand or randmat is written wrongly"];

$holes = {};
buildHead["OpenSWHole", {k_}] := $holes[[k]];
(* MathJSON -> a value, with the variables of env (name -> {value, delayed MathJSON or None})
   and new random numbers for rand and randmat *)
examValue[j_, env_] := Block[{$holes = {}, walk, hole, arg},
  hole[v_] := (AppendTo[$holes, v]; {"OpenSWHole", Length[$holes]});
  arg[x_] := Which[
    AnyTrue[{"Tuple", "Pair", "Triple", "Delimiter"}, startsWith[x, #] &], rangeOf[examValue[#, env] & /@ Rest[x]],
    startsWith[x, "Set"], setOf[examValue[#, env] & /@ Rest[x]],
    True, examValue[x, env]];
  walk[n_String] := If[KeyExistsQ[env, n], If[env[n][[2]] =!= None, walk[env[n][[2]]], hole[env[n][[1]]]], n];
  walk[{h : "rand" | "randmat", args___}] := hole[examRandom[h, arg /@ {args}]];
  walk[n_List] := walk /@ n;
  walk[n_] := n;
  build[walk[j]]];

(* one Setup section: definitions (v := expr once, v = expr each time v is used) and
   conditions; new random numbers until the conditions hold *)
examSetup[statements_, env_] := Module[{mine, found = None},
  Do[
    mine = env;
    Scan[If[!KeyExistsQ[#, "cond"], mine[#["name"]] = If[TrueQ[Lookup[#, "delayed", False]], {None, #["expr"]}, {examValue[#["expr"], mine], None}]] &, statements];
    If[AllTrue[Select[statements, KeyExistsQ[#, "cond"] &], TrueQ[toEqual[examValue[#["cond"], mine]]] &], found = mine; Break[]],
    {500}];
  If[found === None, unsupported["The conditions are too hard to meet: 500 tries failed"]];
  found];

(* \FORMULA{expr}{..}{operation} of a generated exam -> LaTeX *)
examFormula[f_, env_] := Catch[Module[{e = examValue[f[[1]], env], op = ToLowerCase[If[Length[f] > 1 && StringQ[f[[2]]], f[[2]], "evaluate"]]},
    texValue[Switch[op, "numeric" | "evaluate numerically", N[e, 6], "simplify", Simplify[e], "expand", Expand[e], "factor", Factor[e], _, e]]],
  "unsupported", ("\\text{(cannot compute: " <> StringDelete[#1, "{" | "}"] <> ")}") &];

(* one version of an exam: {"seed", "setup", "formulas", "parts": [{"setup", "formulas",
   "questions": [{"setup", "formulas"}]}]} -> the formulas' LaTeX in the same shape *)
exam[p_] := Module[{env, seed = Lookup[p, "seed", Null]},
  If[seed === Null, SeedRandom[], SeedRandom[If[IntegerQ[seed] || StringQ[seed], seed, ToString[seed]]]];
  env = examSetup[Lookup[p, "setup", {}], <||>];
  <|"kind" -> "exam",
    "formulas" -> (examFormula[#, env] & /@ Lookup[p, "formulas", {}]),
    "parts" -> Function[part, With[{penv = examSetup[Lookup[part, "setup", {}], env]},
      <|"formulas" -> (examFormula[#, penv] & /@ Lookup[part, "formulas", {}]),
        "questions" -> Function[q, Catch[With[{qenv = examSetup[Lookup[q, "setup", {}], penv]},
            <|"formulas" -> (examFormula[#, qenv] & /@ Lookup[q, "formulas", {}])|>],
          "unsupported", <|"formulas" -> ConstantArray["\\text{(" <> #1 <> ")}", Length[Lookup[q, "formulas", {}]]]|> &]] /@ Lookup[part, "questions", {}]|>]] /@ Lookup[p, "parts", {}]|>];


operations = <|
  "evaluate" -> evaluate,
  "numeric" -> numeric,
  "simplify" -> (simplify55[lastSide[#]] &),
  "expand" -> (expand55[lastSide[#]] &),
  "factor" -> (factorValue[lastSide[#]] &),
  "determinant" -> (Det[matrixOf[#]] &),
  "inverse" -> (Inverse[invertible[#]] &),
  "transpose" -> (Transpose[matrixOf[#]] &),
  "eigenvalues" -> (texSet[DeleteDuplicates[Eigenvalues[matrixOf[#]]]] &),
  "partialfractions" -> (partialFractions[lastSide[#], None] &),
  "collect" -> (Collect[Expand[lastSide[#]], mainVariable[lastSide[#]]] &),
  "combine" -> (combine55[lastSide[#]] &),
  "rewrite_exp" -> (rewriteExp[lastSide[#]] &),
  "rewrite_sincos" -> (rewriteSinCos[lastSide[#]] &),
  "series" -> (With[{f = lastSide[#]}, Series[f, {mainVariable[f], 0, 5}]] &),
  "pade" -> (With[{f = lastSide[#]}, Factor[Together[PadeApproximant[f, {mainVariable[f], 0, {2, 2}}]]]] &),
  "differentiate" -> (With[{f = lastSide[#]}, D[f, mainVariable[f]]] &),
  "integrate" -> (With[{f = lastSide[#]}, Integrate[f, mainVariable[f]]] &),
  "laplace" -> (With[{f = lastSide[#]}, LaplaceTransform[f, mainVariable[f], var["s"]]] &),
  "inverselaplace" -> (With[{f = lastSide[#]}, InverseLaplaceTransform[f, If[MemberQ[userVariables[f], var["s"]], var["s"], mainVariable[f]], var["t"]]] &),
  (* the same convention as SymPy: F(k) = integral of f(x) e^(-2 pi i k x) dx *)
  "fourier" -> (With[{f = lastSide[#]}, FourierTransform[f, mainVariable[f], var["k"], FourierParameters -> {0, -2 Pi}]] &),
  "rank" -> (MatrixRank[matrixOf[#]] &),
  "rref" -> (RowReduce[matrixOf[#]] &),
  "nullspace" -> (With[{n = NullSpace[matrixOf[#]]}, If[n === {}, {{0}}, Transpose[n]]] &),
  "trace" -> (Tr[matrixOf[#]] &),
  (* det(X I - A), as SymPy's charpoly gives it *)
  "charpoly" -> (With[{m = matrixOf[#]}, Expand[Det[var["X"] IdentityMatrix[Length[m]] - m]]] &),
  "adjugate" -> (Adjugate[matrixOf[#]] &),
  "mean" -> (Mean[numbers[#]] &),
  "median" -> (Median[numbers[#]] &),
  "variance" -> (With[{x = numbers[#]}, If[Length[x] > 1, Variance[x], 0]] &),
  "stddev" -> (With[{x = numbers[#]}, If[Length[x] > 1, StandardDeviation[x], 0]] &)
|>;
(* operations done entry by entry on a matrix *)
elementwise = {"simplify", "factor", "partialfractions", "collect"};

(* in the variable asked for, or x (mainVariable) when there are several: the others are constants *)
partialFractions[e_, v_] := With[{f = Together[e]}, Which[
  v =!= None, Apart[f, v],
  Length[userVariables[f]] > 1, Apart[f, mainVariable[f]],
  True, Apart[f]]];

(* the answer of an operation: a matrix with one entry is a number (a row times a column, as 5.5);
   4 ft + 16 in: different units are added in SI units, as 5.5 *)
finish[r0_] := Module[{r = r0},
  If[MatrixQ[r] && Dimensions[r] == {1, 1}, r = r[[1, 1]]];
  If[Head[r] === Plus && !FreeQ[r, unit55] && Length[DeleteDuplicates[unitPart /@ List @@ r]] > 1, r = Expand[inSI[r]]];
  r];
unitPart[t_] := If[Head[t] === Times, Select[t, !FreeQ[#, unit55] &], If[FreeQ[t, unit55], 1, t]];

paramsQ[j_] := AssociationQ[j] && KeyExistsQ[j, "expr"];
withParams[j_] := If[paramsQ[j], {j["expr"], param /@ Lookup[j, "params", {}]}, {j, {}}];
lpItems[j_] := expr /@ itemsJson[j];

(* operations whose params choose what 5.5 asks in a dialog: the variable, the order, the unknowns
   series [variable, order, point]; differentiate [variable, times]; integrate [variable];
   pade [m, n, variable, point]; partialfractions [variable]; solve, numericsolve [unknowns...,
   and the word 'principal': 5.5's Principal Value Only] *)
optionOps = {"series", "differentiate", "integrate", "solve", "numericsolve", "pade", "partialfractions"};
withOptions[op_, j_] := Module[{e, words, ps, syms, nums, v, at},
  words = StringTrim[#, "'"] & /@ Select[Lookup[j, "params", {}], StringQ[#] && StringStartsQ[#, "'"] &];
  ps = build /@ Select[Lookup[j, "params", {}], !(StringQ[#] && StringStartsQ[#, "'"]) &];
  e = expr[j["expr"]];
  syms = Select[ps, isVar]; nums = Select[ps, NumericQ];
  v = If[syms === {}, If[MemberQ[{"solve", "numericsolve", "partialfractions"}, op], None, mainVariable[lastSide[e]]], First[syms]];
  Switch[op,
    "series", value[Series[lastSide[e], {v, If[Length[nums] > 1, nums[[2]], 0], If[nums === {}, 5, First[nums]]}]],
    "differentiate", value[D[lastSide[e], {v, If[nums === {}, 1, First[nums]]}]],
    "integrate", value[Integrate[lastSide[e], v]],
    "partialfractions", value[partialFractions[lastSide[e], v]],
    "pade", If[Length[nums] < 2, unsupported["Give the degrees m and n of [m/n]"]];
      at = If[Length[nums] > 2, nums[[3]], 0];
      value[Factor[Together[PadeApproximant[lastSide[e], {v, at, {nums[[1]], nums[[2]]}}]]]],
    "solve", solveAnswer[inSI[e], syms, MemberQ[words, "principal"]],
    "numericsolve", solutions[ruleSolutions[numericSolve[inSI[e], syms]]]]];

compute[op_String, j_] /; (op === "define" || op === "evaluate") && ListQ[j] && j =!= {} &&
  MemberQ[{"assume", "additionally", "unassume", "about"}, First[j]] := <|"kind" -> "value", "latex" -> assume[j]|>;
(* D(x) = ..: a function named D (compute.js writes opensw_D): SymPy keeps it *)
compute["define", {"Equal", {"opensw_D", ___}, _}] := fallback[];
compute["define", {"OdeNumeric", eqs_, inits_}] := numericODE[Rest[eqs], Rest /@ Rest[inits]];
(* a_n = .. with 5.5's Interpret Subscript chosen: whether n is an argument or part of the name *)
compute["define", j_?paramsQ] /; MatchQ[Lookup[j, "params", {}], {"'argument'" | "'name'"}] :=
  define[j["expr"], False, StringTrim[First[j["params"]], "'"]];
compute["define", j_?paramsQ] := fallback[];
compute[op_String, j_] /; paramsQ[j] && MemberQ[optionOps, op] := withOptions[op, j];
compute["define", {"Assign", n_, f_}] := (* z := 25a, f := x -> ..: 5.5's assignment (full evaluation) *)
  define[{"Equal", If[startsWith[f, "Function"] && AllTrue[Drop[f, 2], StringQ], Join[{n}, Drop[f, 2]], n], If[startsWith[f, "Function"], f[[2]], f]}, True];
compute[op_String, j_] := Switch[op,
  "version", solutions[{"Mathematica " <> ToString[$VersionNumber]}],
  "cleardefs", $defs = <||>; $matDelims = <||>; $sequences = <||>; $numeric = <||>; $problems = <||>; $assumed = <||>; $ranges = <||>; solutions[{}],
  "showdefs", showDefinitions[],
  "define", define[j, False],
  "solve", If[startsWith[j, "Tuple"], unsupported["Write the equations to solve; this is only a list"]]; solveAnswer[inSI[expr[j]], {}, False],
  "extrema", solutions[extrema[expr[j]]],
  "numericsolve", solutions[ruleSolutions[numericSolve[inSI[expr[j]], {}]]],
  "integersolve", solutions[integerSolve[expr[j]]],
  "ode", solutions[solveODE[expr[odeForm[j]]]],
  "check", <|"kind" -> "boolean", "value" -> check[inSI[expr[j]]]|>,
  "implicitdiff", With[{x = withParams[j]}, <|"kind" -> "solutions", "label" -> ", Derivative: ", "solutions" -> {implicitDiff[expr[x[[1]]], If[x[[2]] === {}, None, First[x[[2]]]]]}|>],
  "byparts", With[{x = withParams[j]}, value[byParts[x[[1]], First[x[[2]]]]]],
  "changevar", With[{x = withParams[j]}, value[changeVariable[x[[1]], First[x[[2]]]]]],
  "approxint", With[{x = withParams[j]}, value[approxIntegral[x[[1]], x[[2, 1]], x[[2, 2]]]]],
  "iterate", With[{x = withParams[j]}, value[iterate[x[[1]], x[[2, 1]], x[[2, 2]]]]],
  "recursion", solutions[{solveRecursion[expr /@ itemsJson[sequenceForm[j]]]}],
  "maximize" | "minimize", solutions[{lpOptimum[lpItems[j], op == "maximize"]}],
  "feasible", <|"kind" -> "text", "text" -> If[lpFeasible[lpItems[j]], " (feasible)", " (infeasible: the constraints have no common solution)"]|>,
  "standardize", <|"kind" -> "solutions", "label" -> ", standard form: ", "solutions" -> {column[lpStandard[lpItems[j]]]}|>,
  "dual", <|"kind" -> "solutions", "label" -> ", dual problem (minimize, all y ≥ 0): ", "solutions" -> {column[lpDual[lpItems[j]]]}|>,
  "plot", plotPoints[j],
  "plot3d", plotGrid[j],
  "plotn", plotValues[j],
  "odeplot", odePoints[j],
  "exam", exam[j],
  _, Which[
    MemberQ[vectorOps, op], With[{p = If[paramsQ[j], j, <|"expr" -> j|>]},
      value[vectorOp[op, expr[p["expr"]], Replace[Select[build /@ Lookup[p, "params", {}], isVar], {} -> (var /@ {"x", "y", "z"})]]]],
    KeyExistsQ[operations, op] && !paramsQ[j], Module[{e, r},
      (* Re(z) = a + b: 5.5 works out the right side *)
      e = expr[j];
      r = If[MemberQ[elementwise, op] && MatrixQ[lastSide[e]], Map[operations[op], lastSide[e], {2}], operations[op][e]];
      value[finish[r]]],
    True, fallback[]]];

(* a decimal in the formula: Evaluate keeps pi as pi *)
hasDecimal[j_] := !FreeQ[j, _Real] || !FreeQ[j, a_Association /; StringContainsQ[ToString[Lookup[a, "num", ""]], "." | "e" | "E"]];

(* the JSON request (UTF-8 bytes) -> the JSON answer (UTF-8 bytes) *)
answer[op_String, data_ByteArray] := Module[{r, j},
  r = Catch[Catch[
    Block[{$names = {}, $delim = None, $listStyle = False, $product = False, $params = {}, $op = op, $holdPi = False, $log10},
      j = ImportByteArray[data, "RawJSON"];
      $log10 = !FreeQ[j, "Log10"];
      $holdPi = op === "evaluate" && hasDecimal[j];
      Quiet[TimeConstrained[compute[op, j], $timeLimit,
        <|"error" -> "The computation took too long (over " <> ToString[$timeLimit] <> " seconds)"|>]]],
    "unsupported", <|"error" -> "Cannot compute this yet: " <> #1|> &],
    "fallback", <|"fallback" -> True|> &];
  If[!AssociationQ[r], r = <|"error" -> "Mathematica could not compute it"|>];
  ExportByteArray[r, "RawJSON", "Compact" -> True]];
answer[op_String, text_String] := answer[op, StringToByteArray[text, "UTF-8"]];

OpenSWCompute[op_String, b64_String] := WriteString["stdout", "@@OPENSW@@" <> BaseEncode[answer[op, BaseDecode[b64]]] <> "\n"];

End[];
EndPackage[];
