(* Mathematica engine of opensw: the same Compute menu as opensw_compute.py, done by a
   Wolfram kernel on the user's computer (Tools > Computation Engine > Mathematica).

   The desktop app keeps one kernel running and sends it lines like
     OpenSW`OpenSWCompute["factor", "<base64 of the MathJSON text>"]
   The answer is one line  @@OPENSW@@<base64 of the JSON answer>  with the same JSON as
   opensw_compute.compute(): {"kind": "value", "latex": ..} | {"kind": "solutions", ..} |
   {"kind": "boolean", ..} | {"error": ..}; {"fallback": true} for an operation this file
   does not know (the editor then asks SymPy).

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
  "Phi" -> "\[CapitalPhi]", "Psi" -> "\[CapitalPsi]", "Omega" -> "\[CapitalOmega]"|>;

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
userVariables[e_] := SortBy[Complement[userSymbols[e], Cases[e, (h_Symbol /; isVar[h])[___] :> h, {0, Infinity}, Heads -> True]], SymbolName];

constants = <|"Pi" -> Pi, "ExponentialE" -> E, "ImaginaryUnit" -> I, "PositiveInfinity" -> Infinity,
  "NegativeInfinity" -> -Infinity, "ComplexInfinity" -> ComplexInfinity, "True" -> True, "False" -> False|>;

functions = <|"Sqrt" -> Sqrt, "Exp" -> Exp, "Ln" -> Log, "Abs" -> Abs,
  "Sin" -> Sin, "Cos" -> Cos, "Tan" -> Tan, "Cot" -> Cot, "Sec" -> Sec, "Csc" -> Csc,
  "Arcsin" -> ArcSin, "Arccos" -> ArcCos, "Arctan" -> ArcTan, "Arccot" -> ArcCot,
  "Sinh" -> Sinh, "Cosh" -> Cosh, "Tanh" -> Tanh, "Coth" -> Coth,
  "Arsinh" -> ArcSinh, "Arcosh" -> ArcCosh, "Artanh" -> ArcTanh,
  "Floor" -> Floor, "Ceil" -> Ceiling, "Factorial" -> Factorial, "Binomial" -> Binomial,
  "Max" -> Max, "Min" -> Min, "Sign" -> Sign, "Gamma" -> Gamma, "Erf" -> Erf,
  "Real" -> Re, "Imaginary" -> Im, "Conjugate" -> Conjugate, "GCD" -> GCD, "LCM" -> LCM,
  "Mod" -> Mod, "Not" -> Not, "And" -> And, "Or" -> Or|>;

(* an equation stays an equation while it is built (Equal[2, 3] would become False) *)
relations = <|"Equal" -> eq, "NotEqual" -> Unequal, "Less" -> Less, "LessEqual" -> LessEqual,
  "Greater" -> Greater, "GreaterEqual" -> GreaterEqual|>;

number[s_String] := Which[
  StringMatchQ[s, RegularExpression["-?[0-9]+"]], FromDigits[StringDelete[s, "-"]] * If[StringStartsQ[s, "-"], -1, 1],
  StringMatchQ[s, RegularExpression["-?[0-9]*\\.?[0-9]*([eE][-+]?[0-9]+)?"]] && StringContainsQ[s, DigitCharacter],
    (* 1.25 is 5/4 exactly, as SymPy's nsimplify reads it *)
    Module[{m = StringCases[s, RegularExpression["(-?)([0-9]*)\\.?([0-9]*)(?:[eE]([-+]?[0-9]+))?"] :> {"$1", "$2", "$3", "$4"}][[1]], digits},
      digits = m[[2]] <> m[[3]];
      If[m[[1]] == "-", -1, 1] * FromDigits[If[digits == "", "0", digits]] / 10^StringLength[m[[3]]] *
        10^If[m[[4]] == "", 0, FromDigits[StringDelete[m[[4]], "+" | "-"]] * If[StringStartsQ[m[[4]], "-"], -1, 1]]],
  s == "Infinity" || s == "+Infinity", Infinity,
  s == "-Infinity", -Infinity,
  True, unsupported["數字 " <> s]];

build[True] := True;
build[False] := False;
build[n_Integer] := n;
build[x_Real] := x;
build[a_Association] := Which[
  KeyExistsQ[a, "num"], number[a["num"]],
  KeyExistsQ[a, "sym"], build[a["sym"]],
  True, unsupported["文字"]];
build[s_String] := Which[
  KeyExistsQ[constants, s], constants[s],
  s == "Nothing", Nothing,
  StringStartsQ[s, "'"], unsupported["文字"],
  True, var[s]];
build[{}] := {};
build[{head_String, args___}] := buildHead[head, {args}];
build[other_] := unsupported[ToString[other]];

buildHead["Error", _] := unsupported["公式裡有看不懂的寫法"];
buildHead["Add", a_] := Plus @@ (build /@ a);
buildHead["Multiply", a_] := Times @@ (build /@ a);
buildHead["Subtract", {x_, y_}] := build[x] - build[y];
buildHead["Subtract", {x_}] := -build[x];
buildHead["Negate", {x_}] := -build[x];
buildHead["Divide", {x_, y_}] := build[x] / build[y];
buildHead["Rational", {x_, y_}] := build[x] / build[y];
buildHead["Power", {x_, y_}] := build[x]^build[y];
buildHead["Square", {x_}] := build[x]^2;
buildHead["Root", {x_, n_}] := build[x]^(1 / build[n]);
buildHead["Log", {x_, b_}] := Log[build[b], build[x]];
buildHead["Log", {x_}] := Log[10, build[x]];
buildHead["Lb", {x_}] := Log[2, build[x]];
buildHead["Complex", {x_, y_}] := build[x] + I build[y];
buildHead["Set", a_] := build /@ a;
buildHead["List", a_] := build /@ a;
buildHead["Matrix", {rows_, ___}] := build[rows];
buildHead[h : "Delimiter" | "Hold" | "Parentheses", a_] := With[{items = build /@ DeleteCases[a, "Nothing"]},
  If[Length[items] == 1, First[items], items]];
buildHead["Block", a_] := build[Last[a]];
buildHead["Determinant", {m_}] := Det[build[m]];
buildHead["Transpose", {m_}] := Transpose[build[m]];
buildHead["Inverse", {m_}] := Inverse[build[m]];
buildHead[h : "Integrate" | "Sum" | "Product", {f_, lims___}] := Module[{body, v, ls},
  {body, v} = functionBody[f];
  ls = limits /@ {lims};
  If[ls === {}, If[v === None, unsupported["不知道對哪個變數" <> If[h == "Integrate", "積分", "加總"]], ls = {v}]];
  (h /. {"Integrate" -> Integrate, "Sum" -> Sum, "Product" -> Product}) @@ Prepend[ls, body]];
buildHead["Limit", {f_, a_}] := Module[{body, v}, {body, v} = functionBody[f];
  If[v === None, unsupported["極限要有變數"]]; Limit[body, v -> build[a]]];
buildHead["D", {f_, vs___}] := D[build[f], Sequence @@ (build /@ {vs})];
buildHead[h_String, a_] /; KeyExistsQ[relations, h] := relations[h] @@ (build /@ a);
buildHead[h_String, a_] /; KeyExistsQ[functions, h] := functions[h] @@ (build /@ a);
(* an unknown head that starts with a small letter is a function the user wrote: f(x) *)
buildHead[h_String, a_] /; LowerCaseQ[StringTake[h, 1]] := var[h] @@ (build /@ a);
buildHead[h_String, _] := unsupported[h];

(* {"Function", {"Block", body}, "x"} -> {body, x}; a plain expression -> {expr, None} *)
functionBody[{"Function", body_, vs___}] := {build[body], If[{vs} === {}, None, var[First[{vs}]]]};
functionBody[f_] := {build[f], None};

(* {"Limits", "x", 0, 1} -> {x, 0, 1}; bounds that are "Nothing" are left out *)
limits[{"Limits" | "Tuple" | "Triple" | "Pair", parts___}] := With[{p = DeleteCases[build /@ {parts}, Nothing]},
  If[Length[p] == 1, First[p], p]];
limits[x_] := build[x];

(* ---------------- the Compute menu ---------------- *)

toEqual[e_] := e /. eq -> Equal;
lastSide[eq[_, b_]] := b;
lastSide[e_] := e;
asEquation[eq[a_, b_]] := a == b;
asEquation[e_] := toEqual[e] == 0;

mainVariable[e_] := Module[{free = userVariables[e]},
  If[free === {}, unsupported["式子裡沒有變數"]];
  First[Join[Select[var /@ {"x", "t", "s", "z", "y"}, MemberQ[free, #] &], free]]];

tex[x_] := StringTrim[ToString[TeXForm[x]]];
(* a matrix shows in parentheses (as in Scientific Word); a vector as a column *)
texMatrix[m_] := "\\begin{pmatrix}" <> StringRiffle[StringRiffle[tex /@ #, " & "] & /@ m, "\\\\"] <> "\\end{pmatrix}";
texValue[rawTeX[t_String]] := t;
texValue[m_?MatrixQ] := texMatrix[m];
texValue[v_List /; VectorQ[v] && v =!= {}] := texMatrix[List /@ v];
texValue[eq[a_, b_]] := texEq[a, b];
texValue[x_] := tex[x];
texEq[a_, b_] := tex[a] <> "=" <> tex[b];
(* a set, as SymPy shows it: \left\{2, 3\right\} *)
texSet[items_] := rawTeX["\\left\\{" <> StringRiffle[tex /@ items, ", "] <> "\\right\\}"];

value[x_] := <|"kind" -> "value", "latex" -> texValue[x]|>;
solutions[sols_List] := <|"kind" -> "solutions", "solutions" -> sols|>;
(* {{x -> 1, y -> 2}, ...} -> {"x=1, y=2", ...} *)
(* "x = 2 + 5 c_1 if c_1 is an integer" is shown as x = 2 + 5 c_1 *)
ruleSolutions[rules_] := StringRiffle[(tex[#[[1]]] <> "=" <> tex[#[[2]]]) & /@ #, ", "] & /@ Normal[rules];

matrixOf[e_] := With[{m = lastSide[e]}, If[MatrixQ[m], m, unsupported["要一個矩陣"]]];
invertible[e_] := With[{m = matrixOf[e]}, If[Length[m] != Length[First[m]] || Simplify[Det[m]] === 0, unsupported["矩陣不可逆"], m]];
numbers[e_] := With[{f = Flatten[{lastSide[e]}]}, If[f === {} || !AllTrue[f, NumericQ], unsupported["要一列數字"], f]];

(* 360 = 2^{3} \cdot 3^{2} \cdot 5 *)
factorValue[n_Integer] := rawTeX[StringRiffle[If[#[[2]] == 1, tex[#[[1]]], tex[#[[1]]] <> "^{" <> tex[#[[2]]] <> "}"] & /@ FactorInteger[n], " \\cdot "]];
factorValue[e_] := Factor[e];

solveAll[e_] := Module[{eqs = asEquation /@ Flatten[{e}], vs},
  vs = userVariables[eqs];
  If[vs === {}, unsupported["式子裡沒有變數"]];
  ruleSolutions[Solve[eqs, vs]]];

check[eq[a_, b_]] := TrueQ[Simplify[a - b] == 0];
check[_] := unsupported["要有等號"];

extrema[e_] := Module[{f = lastSide[e], x}, x = mainVariable[f];
  ruleSolutions[Join[#, {var["f"] -> Simplify[f /. #]}] & /@ Solve[D[f, x] == 0, x]]];

numericSolve[e_] := Module[{q = asEquation[e], x, f}, f = q[[1]] - q[[2]]; x = mainVariable[f];
  (* worked out to 20 digits, shown with 10 *)
  ruleSolutions[N[If[PolynomialQ[f, x], NSolve[q, x, WorkingPrecision -> 20], NSolve[q, x, Reals, WorkingPrecision -> 20]], 10]]];

integerSolve[e_] := Module[{eqs = asEquation /@ Flatten[{e}], vs}, vs = userVariables[eqs];
  ruleSolutions[Solve[eqs, vs, Integers]]];

implicitDiff[e_] := Module[{q = asEquation[e], f, x = var["x"], y = var["y"]}, f = q[[1]] - q[[2]];
  If[FreeQ[f, y], unsupported["要有 x 和 y 的式子"]];
  Simplify[-D[f, x] / D[f, y]]];

(* the unknown of an ODE is a function the user wrote, y(x) *)
solveODE[e_] := Module[{q = asEquation[e], fs, fx},
  fs = DeleteDuplicates[Cases[q, (h_Symbol /; isVar[h])[_Symbol?isVar], {0, Infinity}]];
  If[fs === {}, unsupported["要有未知函數，例如 y(x)"]];
  fx = First[SortBy[fs, ToString]];
  texEq @@@ Flatten[DSolve[q, fx, fx[[1]]], 1]];

(* MathJSON of an ODE as typed (y'' + y = 0, y'(x) = 2y(x), dy/dx = y) -> MathJSON in which
   the unknown is the function y(x) and its derivatives are {"D", {"y", "x"}, "x", ...}
   (the same as ode_form in opensw_compute.py) *)
startsWith[n_, h_] := ListQ[n] && n =!= {} && First[n] === h;
odeForm[j_] := Module[{names = {}, v = None, scan, fix},
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
  If[v === None, v = "x"];
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
  True, unsupported["要一個向量（一行或一列的矩陣）"]]];

vectorOp[op_, e_, xs_] := Module[{F, f = lastSide[e]}, Switch[op,
  "gradient", D[f, {xs}],
  "laplacian", Simplify[Total[D[f, {#, 2}] & /@ xs]],
  "hessian", D[f, {xs, 2}],
  "wronskian", With[{fs = vectorOf[e]}, Simplify[Det[Table[D[fs, {mainVariable[fs], k}], {k, 0, Length[fs] - 1}]]]],
  "divergence", F = vectorOf[e];
    If[Length[F] != Length[xs], unsupported["向量要有 " <> ToString[Length[xs]] <> " 個分量（和基底變數一樣多）"]];
    Simplify[Total[MapThread[D, {F, xs}]]],
  "curl", F = vectorOf[e]; If[Length[F] != 3 || Length[xs] != 3, unsupported["旋度只有三維"]]; Curl[F, xs],
  "jacobian", D[vectorOf[e], {xs}],
  "potential", potential[vectorOf[e], xs],
  "vectorpotential", vectorPotential[vectorOf[e], xs]]];
vectorOps = {"gradient", "divergence", "curl", "laplacian", "hessian", "jacobian", "wronskian", "potential", "vectorpotential"};

(* a scalar potential phi with grad phi = F (F must have curl 0) *)
potential[F_, xs_] := Module[{phi = 0},
  If[Length[F] != Length[xs], unsupported["向量要有 " <> ToString[Length[xs]] <> " 個分量（和基底變數一樣多）"]];
  Do[If[Simplify[D[F[[i]], xs[[j]]] - D[F[[j]], xs[[i]]]] =!= 0, unsupported["這個向量場沒有位勢（旋度不是 0）"]],
    {i, Length[xs]}, {j, i + 1, Length[xs]}];
  Do[phi += Integrate[Simplify[F[[i]] - D[phi, xs[[i]]]], xs[[i]]], {i, Length[xs]}];
  Simplify[phi]];

(* A with curl A = F (F must have divergence 0), A_z = 0 *)
vectorPotential[F_, xs_] := Module[{x, y, z, t, ax, ay},
  If[Length[xs] != 3 || Length[F] != 3, unsupported["向量位勢只有三維"]];
  {x, y, z} = xs;
  If[Simplify[Total[MapThread[D, {F, xs}]]] =!= 0, unsupported["這個向量場沒有向量位勢（散度不是 0）"]];
  ax = Integrate[F[[2]] /. z -> t, {t, 0, z}] - Integrate[F[[3]] /. {y -> t, z -> 0}, {t, 0, y}];
  ay = -Integrate[F[[1]] /. z -> t, {t, 0, z}];
  {Simplify[ax], Simplify[ay], 0}];

(* ---------------- operations that ask for more (5.5 asks in a dialog) ---------------- *)

(* a parameter: a formula, or a word written 'word' *)
param[p_String /; StringStartsQ[p, "'"]] := StringTrim[p, "'"];
param[p_] := expr[p];
wholeNumber[n_] := If[IntegerQ[n], n, unsupported["要是整數"]];

(* the integral the cursor is in, not worked out: {integrand, x, {a, b} or None} *)
integralParts[{"Equal", _, r_}] := integralParts[r];
integralParts[{"Integrate", f_, lim_}] := Module[{body, v, l},
  {body, v} = functionBody[f];
  l = applyDefs[limits[lim]];
  Which[
    ListQ[l] && Length[l] == 3, {applyDefs[body], l[[1]], l[[2 ;; 3]]},
    isVar[l], {applyDefs[body], l, None},
    True, unsupported["要把游標放在一個積分裡"]]];
integralParts[_] := unsupported["要把游標放在一個積分裡"];

heldIntegral[f_, x_, None] := HoldForm[Integrate[f, x]];
heldIntegral[f_, x_, {a_, b_}] := HoldForm[Integrate[f, {x, a, b}]];

(* Calculus > Integrate by Parts: u is the part to differentiate; the integral is left
   as 5.5 shows it: u v - integral of v u' *)
byParts[j_, u_] := Module[{f, x, ab, v, rest, uv},
  {f, x, ab} = integralParts[j];
  v = Integrate[Cancel[f / u], x];
  If[!FreeQ[v, Integrate], unsupported["剩下的部分積不出來，換一個要微分的部分試試"]];
  rest = Simplify[v D[u, x]];
  uv = u v;
  rawTeX[If[ab === None, tex[uv], tex[(uv /. x -> ab[[2]]) - (uv /. x -> ab[[1]])]] <> "-" <> tex[heldIntegral[rest, x, ab]]]];

(* Calculus > Change Variable: q is u = g(x) (new variable u) or x = h(u) *)
changeVariable[j_, q_] := Module[{f, x, ab, lhs, rhs, u, h, sols, g, newAb},
  {f, x, ab} = integralParts[j];
  If[Head[q] =!= eq, unsupported["要寫成 u = g(x) 或 x = h(u)"]];
  {lhs, rhs} = List @@ q;
  Which[
    lhs === x, (* x = h(u) *)
      u = Complement[userVariables[rhs], {x}];
      If[u === {}, unsupported["右邊要有新的變數"]];
      u = First[u];
      newAb = If[ab === None, None, Map[Function[b, principal[u /. Quiet[Solve[rhs == b, u]]]], ab]];
      g = (f /. x -> rhs) D[rhs, u],
    isVar[lhs] && !FreeQ[rhs, x], (* u = g(x) *)
      u = lhs;
      sols = x /. Solve[u == rhs, x];
      If[!ListQ[sols] || sols === {}, unsupported["解不出 x"]];
      (* the branch that gives back the bounds *)
      h = SelectFirst[sols, Function[cand, ab === None || AllTrue[ab, Function[bd, TrueQ[Simplify[(cand /. u -> (rhs /. x -> bd)) == bd]]]]], Last[sols]];
      g = (f /. x -> h) D[h, u];
      newAb = If[ab === None, None, Simplify[rhs /. x -> #] & /@ ab],
    True, unsupported["左邊要是新的變數 u（u = g(x)）或積分變數（x = h(u)）"]];
  (* simplified knowing u stays between the new bounds: sqrt(1 - sin^2 u) = cos u on [0, pi/2] *)
  heldIntegral[If[ab === None || !AllTrue[N[newAb], NumericQ], Simplify[g], Simplify[g, Min[newAb] <= u <= Max[newAb]]], u, newAb]];
(* of the values u can take (x = sin u gives u = 2 pi k, pi + 2 pi k ...) the one nearest 0 *)
principal[{}] := unsupported["上下限換不過去"];
principal[us_List] := First[SortBy[Normal[us] /. C[_] -> 0, If[NumericQ[#], Abs[N[#]], Infinity] &]];
principal[_] := unsupported["上下限換不過去"];

(* Calculus > Approximate Integral: left, midpoint, right, trapezoid or Simpson, n subintervals *)
approxIntegral[j_, method_, n0_] := Module[{f, x, ab, a, b, h, F, n = wholeNumber[n0], r},
  {f, x, ab} = integralParts[j];
  If[ab === None, unsupported["要有上下限的積分"]];
  If[n < 1 || (method == "simpson" && OddQ[n]), unsupported[If[method == "simpson", "Simpson 法的區間數要是正偶數", "區間數要是正整數"]]];
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
  If[count < 1 || count > 1000, unsupported["次數要在 1 到 1000 之間"]];
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
  If[general === {}, unsupported["要有遞迴式，例如 a_{n+1} = 2a_n + 1"]];
  rec = First[general];
  a = Head[First[apps[rec]]];
  n = First[userVariables[First /@ apps[rec]]];
  sol = Quiet[RSolve[Join[{rec}, Select[DeleteCases[qs, rec], MatchQ[#, Equal[a[_Integer], _]] &]], a[n], n]];
  If[!MatchQ[sol, {{_Rule, ___}, ___}], unsupported["這個遞迴式解不出來"]];
  texEq[a[n], Simplify[a[n] /. First[sol]]]];

(* Simplex (linear programming); the variables are taken as nonnegative, as in 5.5 *)
lpParts[items_] := Module[{obj, cons, vs},
  If[Length[items] < 2, unsupported["第一列寫目標函數，下面每列一條限制式"]];
  obj = First[items]; cons = toEqual /@ Rest[items];
  If[!AllTrue[cons, MatchQ[#, _LessEqual | _GreaterEqual | _Less | _Greater | _Equal] &], unsupported["限制式要用 ≤、≥ 或 ="]];
  vs = userVariables[{obj, cons}];
  {obj, cons, vs}];
lpRegion[cons_, vs_] := And @@ Join[cons, Thread[vs >= 0]];

lpOptimum[items_, max_] := Module[{obj, cons, vs, r},
  {obj, cons, vs} = lpParts[items];
  r = Quiet[If[max, Maximize, Minimize][{obj, lpRegion[cons, vs]}, vs]];
  Which[
    r[[1]] === If[max, -Infinity, Infinity], unsupported["限制式沒有共同的解（不可行）"],
    r[[1]] === If[max, Infinity, -Infinity], unsupported[If[max, "沒有最大值", "沒有最小值"]]];
  StringRiffle[Append[(tex[#] <> "=" <> tex[# /. r[[2]]]) & /@ vs, If[max, "\\text{最大值}", "\\text{最小值}"] <> "=" <> tex[r[[1]]]], ", "]];

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

nameOf[s_] := Replace[Keys[Select[$made, # === s &]], {{n_, ___} :> n, {} :> SymbolName[s]}];
noOtherVariables[es_, vs_] := With[{free = Complement[userVariables[es], vs]},
  If[free =!= {}, unsupported["沒有給值的變數 " <> StringRiffle[nameOf /@ free, ", "]]]];
(* a real number, or null where there is none (outside the domain, complex, infinite) *)
realOrNone[v_] := With[{z = Quiet[N[v]]}, If[NumericQ[z] && Abs[Im[z]] < 10^-12 Max[1, Abs[Re[z]]], Re[z], Null]];
toNumber[x_String] := number[x];
toNumber[x_] := x;
grid[a_, b_, n_] := With[{lo = toNumber[a], hi = toNumber[b], k = toNumber[n]}, N[Table[lo + (hi - lo) i / k, {i, 0, k}]]];
(* k + 1 points from t0 to t1 (just t0 when k is 0) *)
steps[t0_, t1_, k_] := If[k == 0, {t0}, Table[t0 + i (t1 - t0) / k, {i, 0, k}]];

plotPoints[p_] := Module[{e = expr[p["expr"]], v = var[Replace[Lookup[p, "var", "x"], Null -> "x"]], xs},
  noOtherVariables[e, {v}];
  xs = grid[p["a"], p["b"], Lookup[p, "n", 100]];
  <|"kind" -> "points", "x" -> xs, "y" -> (realOrNone[e /. v -> #] & /@ xs)|>];

plotGrid[p_] := Module[{e = expr[p["expr"]], xv, yv, xs, ys},
  {xv, yv} = var /@ Replace[Lookup[p, "vars", {"x", "y"}], Null -> {"x", "y"}];
  noOtherVariables[e, {xv, yv}];
  xs = grid[p["a"], p["b"], Lookup[p, "n", 24]];
  ys = grid[p["c"], p["d"], Lookup[p, "m", 24]];
  <|"kind" -> "grid", "x" -> xs, "y" -> ys, "z" -> Table[realOrNone[e /. {xv -> x, yv -> y}], {x, xs}, {y, ys}]|>];

(* values of each formula on the grid of the variables (the last one running fastest);
   grad: the partial derivatives of the one formula; complex: z = x + iy, giving the real
   and imaginary parts (conformal plots) *)
plotValues[p_] := Module[{vs = var /@ p["vars"], es = expr /@ p["exprs"], c = Lookup[p, "complex", Null], axes, pts},
  If[TrueQ[Lookup[p, "grad", False]], es = D[First[es], #] & /@ vs];
  If[StringQ[c], es = {First[es] /. var[c] -> vs[[1]] + I vs[[2]]}];
  noOtherVariables[es, vs];
  axes = MapThread[grid[#1[[1]], #1[[2]], #2] &, {p["ranges"], p["ns"]}];
  pts = Thread[vs -> #] & /@ Tuples[axes];
  <|"kind" -> "values", "axes" -> axes, "values" -> If[StringQ[c],
    With[{zs = Quiet[N[First[es] /. #]] & /@ pts}, {If[NumericQ[#], Re[#], Null] & /@ zs, If[NumericQ[#], Im[#], Null] & /@ zs}],
    Function[e, realOrNone[e /. #] & /@ pts] /@ es]|>];

(* Plot 2D > ODE: first-order equations y' = f(x, y) (or a system) from one initial value
   for each unknown, solved by NDSolve; the same points as the SymPy engine *)
odePoints[p_] := Module[{eqs, ds, funcs, t, inits, x0, a = N[toNumber[p["a"]]], b = N[toNumber[p["b"]]], n = toNumber[Lookup[p, "n", 200]], lo, back, fwd, ts, sol},
  eqs = expr /@ Rest[odeForm[Prepend[p["eqs"], "List"]]];
  ds = Function[e, If[Head[e] =!= eq, unsupported["方程要是等式：y' = f(x, y)"]];
    With[{d = DeleteDuplicates[Cases[e, Derivative[k_][f_][s_] :> {k, f, s}, {0, Infinity}]]},
      If[d === {}, unsupported["方程裡要有導數，例如 y'"]];
      If[Length[d] > 1 || d[[1, 1]] != 1, unsupported["只能畫一階方程（或一階方程組）"]];
      First[d]]] /@ eqs;
  funcs = ds[[All, 2]];
  t = ds[[1, 3]];
  inits = {var[#[[1]]], N[expr[#[[2]]]], N[expr[#[[3]]]]} & /@ p["inits"];
  If[Sort[funcs] =!= Sort[inits[[All, 1]]], unsupported["每個未知函數要有一條方程和一個起始值"]];
  x0 = inits[[1, 2]];
  If[!AllTrue[inits[[All, 2]], # == x0 &], unsupported["起始值要在同一點"]];
  noOtherVariables[eqs, {t}];
  lo = If[b > a, Max[0, Min[n, Round[n (x0 - a) / (b - a)]]], 0];
  back = If[x0 > a, Reverse[steps[x0, a, lo]], {}];
  fwd = If[x0 < b, steps[x0, b, n - lo], {x0}];
  ts = If[back === {}, fwd, Join[Most[back], fwd]];
  sol = Quiet[NDSolve[Join[toEqual /@ eqs, #[[1]][#[[2]]] == #[[3]] & /@ inits], funcs, {t, Min[a, x0], Max[b, x0]}]];
  If[!MatchQ[sol, {{__Rule}, ___}], unsupported["數值解不出來"]];
  <|"kind" -> "ode", "x" -> ts, "var" -> nameOf[t], "y" -> Association[Function[f, With[{g = f /. First[sol]},
    nameOf[f] -> (If[g["Domain"][[1, 1]] <= # <= g["Domain"][[1, 2]], realOrNone[g[#]], Null] & /@ ts)]] /@ funcs]|>];

(* ---------------- Tools > Exam Builder ---------------- *)

(* rand(), rand(n) in 0..n-1, rand(n, m) in n..m, rand({set}); randmat(rows, cols, type, range)
   with type 1 any, 2 symmetric, 3 antisymmetric, 4 unimodular (as 5.5's Exam Builder) *)
pick[setOf[l_]] := RandomChoice[l];
pick[l_List] := RandomChoice[Flatten[l]]; (* a set kept in a variable: s = {2, 3, 5} *)
pick[rangeOf[{lo_, hi_, ___}]] := RandomInteger[{lo, hi}];
pick[rangeOf[{n_}]] := pick[n];
pick[n_] := If[IntegerQ[n] && n >= 1, RandomInteger[n - 1], unsupported["rand(n) 的 n 要是正整數"]];
examRandom["rand", {}] := RandomInteger[10^12 - 1];
examRandom["rand", {r_}] := pick[r];
examRandom["rand", {r1_, r2_, ___}] := pick[rangeOf[{r1, r2}]];
examRandom["randmat", {rows_, cols_, typ_, r_ : rangeOf[{10}], ___}] := Module[{m, low, up},
  If[MemberQ[{2, 3, 4}, typ] && rows != cols, unsupported["對稱、反對稱、么模矩陣要是方陣"]];
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
examRandom[_, _] := unsupported["rand 或 randmat 的寫法不對"];

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
  If[found === None, unsupported["條件太難滿足：試了 500 次都不行"]];
  found];

(* \FORMULA{expr}{..}{operation} of a generated exam -> LaTeX *)
examFormula[f_, env_] := Catch[Module[{e = examValue[f[[1]], env], op = ToLowerCase[If[Length[f] > 1 && StringQ[f[[2]]], f[[2]], "evaluate"]]},
    texValue[Switch[op, "numeric" | "evaluate numerically", N[e, 6], "simplify", Simplify[e], "expand", Expand[e], "factor", Factor[e], _, e]]],
  "unsupported", ("\\text{(算不出：" <> StringDelete[#1, "{" | "}"] <> ")}") &];

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
  "evaluate" -> (lastSide[#] &),
  "numeric" -> (N[lastSide[#], 10] &),
  "simplify" -> (Simplify[lastSide[#]] &),
  "expand" -> (Expand[lastSide[#]] &),
  "factor" -> (factorValue[lastSide[#]] &),
  "determinant" -> (Det[matrixOf[#]] &),
  "inverse" -> (Inverse[invertible[#]] &),
  "transpose" -> (Transpose[matrixOf[#]] &),
  "eigenvalues" -> (texSet[DeleteDuplicates[Eigenvalues[matrixOf[#]]]] &),
  "partialfractions" -> (Apart[Together[lastSide[#]]] &),
  "collect" -> (Collect[Expand[lastSide[#]], mainVariable[lastSide[#]]] &),
  (* Polynomials > Combine: one fraction, trigonometry simplified, logarithms and powers joined *)
  "combine" -> (Simplify[Together[lastSide[#]]] //. c_. Log[a_] + d_. Log[b_] :> Log[a^c b^d] &),
  "rewrite_exp" -> (TrigToExp[lastSide[#]] &),
  "rewrite_sincos" -> (ExpToTrig[lastSide[#]] &),
  "series" -> (With[{f = lastSide[#]}, Series[f, {mainVariable[f], 0, 5}]] &),
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
  "stddev" -> (With[{x = numbers[#]}, If[Length[x] > 1, StandardDeviation[x], 0]] &),
  "implicitdiff" -> implicitDiff
|>;

(* Compute > Definitions: x = 3 or f(x) = x^2, used by every later computation.
   $defs: name -> {argument symbols, value}; applyDefs puts them into a formula. *)
$defs = <||>;
defRules[] := KeyValueMap[Function[{name, d}, If[d[[1]] === None, var[name] -> d[[2]],
  With[{ps = d[[1]], body = d[[2]]}, var[name][args___] /; Length[{args}] == Length[ps] :> (body /. Thread[ps -> {args}])]]], $defs];
applyDefs[e_] := If[$defs === <||>, e, FixedPoint[ReplaceAll[#, defRules[]] &, e, 5]];
expr[j_] := applyDefs[build[j]];

define[j_] := Module[{lhs, r},
  If[!MatchQ[j, {"Equal", _, _}], unsupported["定義要寫成 x = 3 或 f(x) = x^2"]];
  lhs = j[[2]];
  r = expr[j[[3]]];
  Which[
    StringQ[lhs] && !KeyExistsQ[constants, lhs], $defs[lhs] = {None, r}; value[eq[var[lhs], r]],
    ListQ[lhs] && Length[lhs] > 1 && StringQ[First[lhs]] && LowerCaseQ[StringTake[First[lhs], 1]] && AllTrue[Rest[lhs], StringQ],
      $defs[First[lhs]] = {var /@ Rest[lhs], r}; value[eq[var[First[lhs]] @@ (var /@ Rest[lhs]), r]],
    True, unsupported["左邊要是一個名稱或 f(x) 這種函數"]]];

showDefinitions[] := solutions[KeyValueMap[Function[{name, d},
  texEq[If[d[[1]] === None, var[name], var[name] @@ d[[1]]], d[[2]]]], $defs]];

paramsQ[j_] := AssociationQ[j] && KeyExistsQ[j, "expr"];
withParams[j_] := If[paramsQ[j], {j["expr"], param /@ Lookup[j, "params", {}]}, {j, {}}];
lpItems[j_] := expr /@ itemsJson[j];

compute[op_String, j_] := Switch[op,
  "version", solutions[{"Mathematica " <> ToString[$VersionNumber]}],
  "cleardefs", $defs = <||>; solutions[{}],
  "showdefs", showDefinitions[],
  "define", define[j],
  "solve", solutions[solveAll[expr[j]]],
  "extrema", solutions[extrema[expr[j]]],
  "numericsolve", solutions[numericSolve[expr[j]]],
  "integersolve", solutions[integerSolve[expr[j]]],
  "ode", solutions[solveODE[expr[odeForm[j]]]],
  "check", <|"kind" -> "boolean", "value" -> check[expr[j]]|>,
  "byparts", With[{x = withParams[j]}, value[byParts[x[[1]], First[x[[2]]]]]],
  "changevar", With[{x = withParams[j]}, value[changeVariable[x[[1]], First[x[[2]]]]]],
  "approxint", With[{x = withParams[j]}, value[approxIntegral[x[[1]], x[[2, 1]], x[[2, 2]]]]],
  "iterate", With[{x = withParams[j]}, value[iterate[x[[1]], x[[2, 1]], x[[2, 2]]]]],
  "recursion", solutions[{solveRecursion[expr /@ itemsJson[sequenceForm[j]]]}],
  "maximize" | "minimize", solutions[{lpOptimum[lpItems[j], op == "maximize"]}],
  "feasible", <|"kind" -> "text", "text" -> If[lpFeasible[lpItems[j]], "（可行）", "（不可行：限制式沒有共同的解）"]|>,
  "standardize", <|"kind" -> "solutions", "label" -> "，標準形式：", "solutions" -> {column[lpStandard[lpItems[j]]]}|>,
  "dual", <|"kind" -> "solutions", "label" -> "，對偶問題（求最小值，y 都 ≥ 0）：", "solutions" -> {column[lpDual[lpItems[j]]]}|>,
  "plot", plotPoints[j],
  "plot3d", plotGrid[j],
  "plotn", plotValues[j],
  "odeplot", odePoints[j],
  "exam", exam[j],
  _, Which[
    MemberQ[vectorOps, op], With[{p = If[paramsQ[j], j, <|"expr" -> j|>]},
      value[vectorOp[op, expr[p["expr"]], Replace[Select[build /@ Lookup[p, "params", {}], isVar], {} -> (var /@ {"x", "y", "z"})]]]],
    KeyExistsQ[operations, op] && !paramsQ[j], value[operations[op][expr[j]]],
    True, fallback[]]];

(* the JSON request (UTF-8 bytes) -> the JSON answer (UTF-8 bytes) *)
answer[op_String, data_ByteArray] := Module[{r},
  r = Catch[Catch[
    Quiet[TimeConstrained[compute[op, ImportByteArray[data, "RawJSON"]], $timeLimit,
      <|"error" -> "計算太久（超過 " <> ToString[$timeLimit] <> " 秒）"|>]],
    "unsupported", <|"error" -> "還不能計算：" <> #1|> &],
    "fallback", <|"fallback" -> True|> &];
  If[!AssociationQ[r], r = <|"error" -> "Mathematica 算不出來"|>];
  ExportByteArray[r, "RawJSON", "Compact" -> True]];
answer[op_String, text_String] := answer[op, StringToByteArray[text, "UTF-8"]];

OpenSWCompute[op_String, b64_String] := WriteString["stdout", "@@OPENSW@@" <> BaseEncode[answer[op, BaseDecode[b64]]] <> "\n"];

End[];
EndPackage[];
