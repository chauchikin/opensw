"""Integral acceptance and step checking regressions; external backends skip if absent.
Run with a Python containing SymPy: python -B test/engine_integral_safety.py.
"""
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))
import sympy as sp
import mpmath
import opensw_compute as oc
import opensw_giac as g
import opensw_fricas as fr

x, a, b, c, y = sp.symbols('x a b c y')
xr = sp.Symbol('x', real=True)
xp = sp.Symbol('x', positive=True)
q = sp.Rational

def wrong_cases():
    narrow = (x-q(2,5))*(x-q(1,2))
    return [
        ('P02', sp.sqrt(x*x+20*x+100), x*x/2+10*x),
        ('P03', sp.sqrt(sp.expand((x*x-q(1,100))**2)), x**3/3-x/100),
        ('P04', sp.sqrt(sp.expand(narrow**2)), sp.integrate(narrow,x)),
        ('P09', sp.sqrt(x*x+2*x+1)/10**22, sp.S.Zero),
        ('P10', sp.exp(-x*x)*sp.sqrt(x*x+14*x+49), 7*sp.sqrt(sp.pi)*sp.erf(x)/2-sp.exp(-x*x)/2),
        ('P18', sp.sqrt(a*a*x*x), a*x*x/2),
        ('P19', sp.sqrt(a*a*x*x+2*a*x+1), a*x*x/2+x),
        ('P20', a+sp.sqrt(b*b*(x*x+1)), a*x+b*(x*sp.sqrt(x*x+1)+sp.asinh(x))/2),
        ('complex x', sp.sqrt(x**4), x**3/3),
        ('reciprocal square', sp.sqrt(x**-2), sp.log(x)),
        ('algebraic coefficient', sp.sqrt(x*x+200*sp.sqrt(2)*x+20000), x*x/2+100*sp.sqrt(2)*x),
    ]

class Acceptance(unittest.TestCase):
    def test_wrong_candidates(self):
        for name, f, r in wrong_cases():
            with self.subTest(name=name):
                self.assertFalse(g.same_derivative(r, f, x))

    def test_relative_error(self):
        self.assertFalse(g.close(mpmath.mpf('1e-40'), mpmath.mpf('-1e-40'), 20))
        self.assertFalse(g.same_derivative(sp.S.Zero, x/10**22, x))
        self.assertTrue(g.same_derivative(x*x/(2*10**22), x/10**22, x))
        self.assertFalse(g.same_derivative(x*x/(2*10**100), x/10**100, x))  # no usable evidence

    def test_parameter_signs_independent_without_risk(self):
        # No roots or Abs in the integrand: the numerical sieve must test all signs.
        self.assertFalse(g.same_derivative(sp.Abs(a)*x*x/2, a*x, x))
        self.assertFalse(g.same_derivative(sp.Abs(b)*x*x/2+a*x, b*x+a, x))
        self.assertFalse(g.same_derivative(a*x*sp.Abs(x)/2, sp.Abs(a)*x, x))

    def test_undefined_derivative_is_not_skipped(self):
        real_lambdify = sp.lambdify
        made = []
        def lambdify(args, expr, *rest, **kw):
            made.append(expr)
            if expr == 2*x and len(made) == 1:
                def fail_on_negative(v, *args):
                    if v < 0:
                        raise ValueError('candidate undefined')
                    return 2*v
                return fail_on_negative
            return real_lambdify(args, expr, *rest, **kw)
        with patch.object(sp, 'lambdify', side_effect=lambdify):
            self.assertFalse(g.same_derivative(x*x, 2*x, x))

    def test_risky_correct_candidates(self):
        self.assertTrue(g.same_derivative(sp.Abs(xr), sp.sign(xr), xr))
        self.assertTrue(g.same_derivative(x*sp.sqrt(x*x+20*x+100)/2+5*sp.sqrt(x*x+20*x+100),
                                          sp.sqrt(x*x+20*x+100), x))
        self.assertTrue(g.same_derivative(3*x*(x*x)**q(1,3)/5, (x*x)**q(1,3), x))

    def test_risk_shapes(self):
        self.assertTrue(hasattr(g, 'branch_risk'))
        for f in [sp.sqrt(x**4), sp.sqrt(x**-2), (x*x)**q(1,3), sp.sqrt(sp.sin(x)**2),
                  sp.sqrt(sp.expand((a*x+1)**2)), sp.sqrt(b*b*(x*x+1)),
                  sp.sqrt(x*x+200*sp.sqrt(2)*x+20000),
                  sp.Abs(x), sp.sign(xr)]:
            with self.subTest(f=f):
                self.assertTrue(g.branch_risk(f))
        for f in [sp.sqrt(x*x+1), sp.sqrt(1+sp.sin(x)), sp.exp(x)*sp.sin(2*x), 1/(x*x+1)]:
            self.assertFalse(g.branch_risk(f))

    def test_evaluate_and_backend_candidates(self):
        have = {'Giac': g.WORKER.start(), 'FriCAS': fr.WORKER.start()}
        for backend, present in have.items():
            if not present:
                print('skipped: '+backend+' not installed; symbolic and mock checks still run')
        for name, f, wrong in wrong_cases():
            for backend, call in [('Giac', lambda: g.integral(f,(x,))), ('FriCAS',lambda: fr.integral(f,x))]:
                if have[backend]:
                    with self.subTest(name=name, backend=backend):
                        r = call()
                        self.assertTrue(r is None or sp.simplify(sp.diff(r,x)-f)==0, r)
            if name not in ('P10', 'P20'):
                r = oc.evaluate(sp.Integral(f,x))
                with self.subTest(name=name, backend='Evaluate'):
                    if not r.has(sp.Integral):
                        d = sp.diff(r,x)
                        for xv in [-200, -15, -3, q(-1,20), q(1,20), q(9,20), 2, 15, sp.I]:
                            for av in [-2,2]:
                                point={x:xv,a:av,b:-2}
                                error=complex(sp.N((d-f).subs(point),30))
                                self.assertLess(abs(error), 1e-12, (name,r,point,error))

    def test_piecewise_variable_conditions(self):
        for f in [sp.Abs(xr), sp.sign(xr)]:
            r = oc.evaluate(sp.Integral(f,xr))
            for value in [-10,-2,q(-1,100),q(1,100),2,10]:
                self.assertEqual(sp.simplify((sp.diff(r,xr)-f).subs(xr,value)),0, (f,r))

    def test_piecewise_parameter_only(self):
        r = sp.Piecewise((sp.log(x), sp.Eq(a,-1)), (x**(a+1)/(a+1),True))
        self.assertEqual(oc.antiderivative(sp.Integral(x**a,x),r),r.args[-1].expr)

    def test_mock_shifted_root_pipeline(self):
        f=sp.sqrt((x+100)**2)
        with patch.object(g.WORKER,'off',True), patch.object(fr.WORKER,'off',False), \
                patch.object(fr.WORKER,'ask',return_value='zv1^2/2+100*zv1'):
            self.assertIsNone(fr.integral(f,x))
            r=oc.evaluate(sp.Integral(f,x))
            self.assertEqual(sp.simplify((sp.diff(r,x)-f).subs(x,-101)),0)

class Steps(unittest.TestCase):
    def test_no_antiderivative_backend(self):
        with patch.object(oc, 'integrals_done', side_effect=AssertionError('must not integrate')), \
                patch.object(g,'integral',side_effect=AssertionError('must not ask Giac')), \
                patch.object(fr,'integral',side_effect=AssertionError('must not ask FriCAS')):
            self.assertEqual(oc.step_check(sp.Integral(x,x), x*x/2+7)['result'],'unknown')
            self.assertEqual(oc.step_check(sp.Integral(2*x,x), x*x)['result'],'equal')

    def test_constants_and_trig(self):
        for lhs, rhs in [(sp.Integral(2*x,x), x*x+1), (sp.Integral(x,x), x*x/2+7),
                         (sp.Integral(2*sp.sin(x)*sp.cos(x),x), -sp.cos(x)**2)]:
            with self.subTest(lhs=lhs, rhs=rhs):
                self.assertEqual(oc.step_check(lhs,rhs)['result'],'unknown')

    def test_exact_sympy_primitives(self):
        for lhs, rhs in [(sp.Integral(2*x,x), x*x), (sp.Integral(x,x), x*x/2),
                         (sp.Integral(2*sp.sin(x)*sp.cos(x),x), sp.sin(x)**2),
                         (sp.Integral(2*sp.sin(x)*sp.cos(x),x), 1-sp.cos(x)**2)]:
            with self.subTest(lhs=lhs, rhs=rhs):
                self.assertEqual(oc.step_check(lhs,rhs)['result'],'equal')

    def test_sympy_unresolved_or_failed_is_unknown(self):
        integral = sp.Integral(2*x,x)
        with patch.object(sp.Integral, 'doit', return_value=integral):
            self.assertEqual(oc.step_check(integral,x*x)['result'],'unknown')
            # Identical unresolved integrals must not cancel to create a proof.
            self.assertEqual(oc.step_check(integral,integral)['result'],'unknown')
        with patch.object(sp.Integral, 'doit', side_effect=NotImplementedError('no primitive')):
            self.assertEqual(oc.step_check(integral,x*x)['result'],'unknown')

    def test_derivative_proof_required_before_primitive_cancellation(self):
        integral = sp.Integral(sp.sqrt(x*x+20*x+100),x)
        wrong = x*x/2+10*x
        with patch.object(sp.Integral, 'doit', return_value=wrong):
            self.assertEqual(oc.step_check(integral,wrong)['result'],'unknown')
        f = sp.Function('f')(x)
        with patch.object(sp.Integral, 'doit', return_value=x*x):
            self.assertEqual(oc.step_check(sp.Integral(f,x),x*x)['result'],'unknown')

    def test_wrong_and_cancelled_symbols(self):
        self.assertNotEqual(oc.step_check(sp.Integral(sp.sqrt(x*x+20*x+100),x),x*x/2+10*x)['result'],'equal')
        self.assertEqual(oc.step_check(sp.Integral(x,x),x*x)['result'],'notequal')
        self.assertEqual(oc.step_check(sp.Integral(x,x)+c*x,x*x+c*x)['result'],'notequal')
        self.assertNotEqual(oc.step_check(sp.Integral(sp.sqrt(x**4),x),x**3/3)['result'],'equal')

    def test_nested_product_and_different_variables(self):
        for lhs,rhs in [(sp.Integral(1,x,x), x*x/2+3*x+5),
                        (x*sp.Integral(2*sp.sin(x)*sp.cos(x),x),-x*sp.cos(x)**2),
                        (sp.Integral(x,x),sp.Integral(y,y))]:
            self.assertEqual(oc.step_check(lhs,rhs)['result'],'unknown')

    def test_positive_and_ranges(self):
        self.assertNotEqual(oc.step_check(sp.Integral(sp.sqrt(xp*xp+2*xp+1),xp),xp*xp/2+xp+1)['result'],'notequal')
        old = oc.RANGES.copy()
        try:
            oc.RANGES['x']=(sp.Interval.open(0,1),None)
            self.assertNotEqual(oc.step_check(sp.Integral(sp.sqrt(x*x+2*x+1),x),x*x/2+x+1)['result'],'notequal')
            oc.RANGES['x']=(sp.Interval.open(3,4),None)
            self.assertEqual(oc.step_check(sp.Integral(x,x),x*x)['result'],'notequal')
        finally:
            oc.RANGES.clear()
            oc.RANGES.update(old)

    def test_definite_unchanged(self):
        self.assertEqual(oc.step_check(sp.Integral(x,(x,0,1)),q(1,2))['result'],'equal')
        self.assertEqual(oc.step_check(sp.Integral(x,(x,0,1)),sp.S(2))['result'],'notequal')

    def test_mixed_definite(self):
        self.assertEqual(oc.step_check(sp.Integral(x,x)+sp.Integral(y,(y,0,1)),x*x/2+q(1,2)+7)['result'],'unknown')
        self.assertEqual(oc.step_check(sp.Integral(x,x)+sp.Integral(y,(y,0,1)),x*x/2+q(1,2))['result'],'equal')
        self.assertEqual(oc.step_check(sp.Integral(x,x)+sp.Integral(1/y**2,(y,-1,1)),x*x/2-2)['result'],'unknown')

if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        g.WORKER.stop()
        fr.WORKER.stop()
