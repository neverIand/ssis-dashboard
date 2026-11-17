"""Lexical cases for the authored source budget."""

import unittest

from tests.source_size import strip_comments


class StripCommentsTests(unittest.TestCase):
    def test_javascript_strings_preserve_comment_markers_and_urls(self):
        code = r'''const items = ['escaped\' // /*', "escaped\" // /*", "https://example.org/a/*b"];'''
        source = '/* heading */\n' + code + ' // end of line\n'
        self.assertEqual(strip_comments(source, '.js'), '\n' + code + ' \n')

    def test_templates_preserve_literal_text_and_scan_nested_interpolations(self):
        opening = r'const text = `outer // /* \` \${literal} ${format({'
        name = "  name: 'url://path/*',"
        nested = '  text: `nested // /* ${[/[//]|[/*]/, "// /*"].length}`,'
        source = '\n'.join([opening, name + ' // name', nested, '  value: 1 /* add */ + 2', '})}`; /* end */'])
        expected = '\n'.join([opening, name + ' ', nested, '  value: 1  + 2', '})}`; '])
        self.assertEqual(strip_comments(source, '.js'), expected)

    def test_javascript_regex_after_expression_prefixes(self):
        regex = r'/[//]|[/*]|[/]|\/\*/g'
        for prefix, suffix in [('const r = (', ');'), ('use(1, ', ');'), ('const r = ', ';'),
                               ('function f() { return ', '; }')]:
            with self.subTest(prefix=prefix):
                self.assertEqual(strip_comments(prefix + '/* comment */' + regex + suffix + '// end', '.js'),
                                 prefix + regex + suffix)

    def test_javascript_division_after_values(self):
        for dividend in ['(total + 1)', 'total', 'a\u0301return', '12', '1.2e+3', '123n', 'item.return', 'count++',
                         '{ amount: 1 }', 'function() {}', 'class {}', 'flag ? total : { amount: 1 }']:
            with self.subTest(dividend=dividend):
                source = f'const result = {dividend} /* numerator */ / /* denominator */ 2; // end'
                self.assertEqual(strip_comments(source, '.js'), f'const result = {dividend}  /  2; ')

    def test_javascript_regex_at_statement_boundaries(self):
        for prefix in ['if (ok) ', 'if (ok) {} ', 'function run() {} ', 'label: {} ']:
            with self.subTest(prefix=prefix):
                code = prefix + '/[//]/.test(path);'
                self.assertEqual(strip_comments(code + ' // end', '.js'), code + ' ')

    def test_javascript_regex_after_line_terminated_statements(self):
        for prefix, suffix in [('function f() { return\nfunction g() {} ', '}'),
                               ('while (ready) { break\n', '}'),
                               ('label: while (ready) { continue label\n', '}'),
                               ('debugger\n', '')]:
            with self.subTest(prefix=prefix):
                code = prefix + '/[//]/.test(path); '
                self.assertEqual(strip_comments(code + '/* end */' + suffix, '.js'), code + suffix)

    def test_javascript_for_of_regex_and_contextual_identifier(self):
        source = 'for (const of of /[//]/g.exec(path)) {} // loop\nconst of = 4; of / /* comment */ 2;'
        expected = 'for (const of of /[//]/g.exec(path)) {} \nconst of = 4; of /  2;'
        self.assertEqual(strip_comments(source, '.js'), expected)

    def test_preserves_whitespace_line_endings_and_unicode(self):
        source = 'const café = "🚀"; // café\r\n\r\n  // drop\n\t// drop\r// drop\u2028// drop\u2029// end'
        self.assertEqual(strip_comments(source, '.js'), 'const café = "🚀"; \r\n\r\n  \n\t\r\u2028\u2029')

    def test_css_preserves_strings_and_slash_pairs(self):
        double = r'a::before { content: "/* escaped \" */ https://example.org/"; }'
        single = r"b::after { content: '/* escaped \' */'; }"
        source = double + '\n/* across\r\nlines */\n' + single + '\na { background: url(//example.org/a); }'
        expected = double + '\n\n' + single + '\na { background: url(//example.org/a); }'
        self.assertEqual(strip_comments(source, '.css'), expected)

    def test_preserves_legal_comments(self):
        for suffix, legal in [('.js', '//! legal\r\n// @preserve\n/*! legal */ /* @license */'),
                              ('.css', '/*! legal */ /* @preserve */ /* @license */')]:
            with self.subTest(suffix=suffix):
                self.assertEqual(strip_comments(legal + '\n/* ordinary */\n', suffix), legal + '\n\n')

    def test_rejects_unterminated_input(self):
        for suffix, source, kind in [
            ('.js', "const a = 'x", 'string'),
            ('.js', 'const a = "x\n"', 'string'),
            ('.js', 'const a = `escaped \\`', 'template literal'),
            ('.js', 'const a = `outer ${1', 'template literal'),
            ('.js', 'const a = `outer ${"x', 'string'),
            ('.js', 'const a = /escaped\\/', 'regular expression'),
            ('.js', 'const a = /[/\n]/', 'regular expression'),
            ('.js', 'const a = /a\\\n/', 'regular expression'),
            ('.js', 'const a = `outer ${1 /* x', 'block comment'),
            ('.js', '/* x', 'block comment'),
            ('.css', 'a { content: "x', 'string'),
            ('.css', 'a { content: "x\fx"; }', 'string'),
            ('.css', '/*! x', 'block comment'),
        ]:
            with self.subTest(suffix=suffix, source=source):
                with self.assertRaisesRegex(ValueError, f'Unterminated {kind} at offset'):
                    strip_comments(source, suffix)
