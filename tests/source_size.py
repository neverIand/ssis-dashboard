"""Frontend JS/CSS size: authored bytes without ordinary comments (reported) and packaged gzip-9 bytes (budgeted).

Run `python -m tests.source_size` from the repository root, after `npm --prefix web run build`, to print both totals.
"""

import gzip
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / 'web/src'
ASSET_ROOT = ROOT / 'dashboard/static/app'


_JS_LINE_END = re.compile(r'[\r\n\u2028\u2029]')
# JavaScript punctuators are ASCII. Keep non-ASCII identifier parts, including combining marks, together.
_JS_WORD = re.compile(r'(?:[a-zA-Z0-9_$]|[^\x00-\x7f\s\ufeff]|\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\}))+')
_JS_PUNCTUATOR = re.compile(r'\+\+|--|=>|\?\.|\?\?=?|\.\.\.|.')
_FOR_HEADS = {'for', 'for await'}
_CONTROL_HEADS = {'if', 'while', 'switch', 'catch', 'with'}
_LINE_TERMINATED_STATEMENTS = {'return', 'break', 'continue', 'debugger', '<jump label>'}
_EXPRESSION_PREFIXES = {
    'return', 'throw', 'case', 'default', 'delete', 'void', 'typeof',
    'yield', 'await', 'new', 'in', 'instanceof', 'extends', '...', '=>', '??', '??=', '<for-of separator>',
    *'([,{:;=!?~*%&|^<>+-/',
}


def _after_escape(source, index):
    return index + (3 if source.startswith('\r\n', index + 1) else 2)


def _quoted_end(source, start, line_breaks):
    quote = source[start]
    index = start + 1
    while index < len(source):
        char = source[index]
        if char == quote:
            return index + 1
        if char in line_breaks:
            break
        index = _after_escape(source, index) if char == '\\' else index + 1
    raise ValueError(f'Unterminated string at offset {start}')


def _regex_end(source, start):
    index = start + 1
    in_class = False
    while index < len(source):
        char = source[index]
        if char in '\r\n\u2028\u2029':
            break
        if char == '\\':
            if _JS_LINE_END.match(source, index + 1):
                break
            index += 2
            continue
        if char == '/' and not in_class:
            flags = _JS_WORD.match(source, index + 1)
            return flags.end() if flags else index + 1
        if char == '[':
            in_class = True
        elif char == ']':
            in_class = False
        index += 1
    raise ValueError(f'Unterminated regular expression at offset {start}')


class _CommentStripper:
    def __init__(self, source):
        self.source = source
        self.kept_from = 0
        self.parts = []

    def comment_end(self, start):
        source = self.source
        if source.startswith('//', start):
            line_end = _JS_LINE_END.search(source, start + 2)
            end = line_end.start() if line_end else len(source)
        else:
            close = source.find('*/', start + 2)
            if close < 0:
                raise ValueError(f'Unterminated block comment at offset {start}')
            end = close + 2
        comment = source[start:end]
        if not (comment.startswith(('/*!', '//!')) or '@license' in comment or '@preserve' in comment):
            self.parts.append(source[self.kept_from:start])
            self.kept_from = end
        return end

    def css(self):
        source = self.source
        index = 0
        while index < len(source):
            char = source[index]
            if char in "'\"":
                index = _quoted_end(source, index, '\r\n\f')
            elif source.startswith('/*', index):
                index = self.comment_end(index)
            else:
                index = _after_escape(source, index) if char == '\\' else index + 1

    def template_end(self, start):
        source = self.source
        index = start + 1
        while index < len(source):
            char = source[index]
            if char == '`':
                return index + 1
            if source.startswith('${', index):
                index = self.javascript(index + 2, template_start=start)
            else:
                index = _after_escape(source, index) if char == '\\' else index + 1
        raise ValueError(f'Unterminated template literal at offset {start}')

    def javascript(self, index=0, template_start=None):
        source = self.source
        # Closing a control head or a statement block can start a new statement with a regex.
        scopes = ['block' if template_start is None else 'interpolation']
        statement = template_start is None
        regex_allowed = True
        previous = ''
        previous_end = index
        while index < len(source):
            char = source[index]
            if char.isspace() or char == '\ufeff':
                index += 1
                continue
            if source.startswith(('//', '/*'), index):
                index = self.comment_end(index)
                continue

            start = index
            line_break = bool(_JS_LINE_END.search(source, previous_end, start))
            if line_break and previous in _LINE_TERMINATED_STATEMENTS:
                statement = regex_allowed = True

            if char in "'\"":
                token, index = '<value>', _quoted_end(source, index, '\r\n')
            elif char == '`':
                token, index = '<value>', self.template_end(index)
            elif char == '/' and regex_allowed:
                token, index = '<value>', _regex_end(source, index)
            elif word := _JS_WORD.match(source, index):
                token = word.group()
                if previous in {'.', '?.', '#'}:
                    token = '<property>'
                elif previous in {'break', 'continue'} and not line_break:
                    token = '<jump label>'
                index = word.end()
            else:
                punctuator = _JS_PUNCTUATOR.match(source, index)
                token, index = punctuator.group(), punctuator.end()

            next_statement = False
            async_expression = previous == '<async expression>' and not line_break
            if token in {'function', 'class'} and (regex_allowed or async_expression):
                property_name = scopes[-1] == 'object' and previous in {'{', ','}
                if not statement and previous != 'default' and not property_name:
                    scopes.append('expression body')
            elif token == 'async' and regex_allowed and not statement and previous != 'default':
                token = '<async expression>'
            elif token == '(':
                if previous in _FOR_HEADS:
                    scopes.append('for')
                else:
                    scopes.append('control' if previous in _CONTROL_HEADS else 'group')
            elif token == '[':
                scopes.append('array')
            elif token == '{':
                next_statement = statement or not regex_allowed or previous in {'=>', 'try', 'catch', 'finally'}
                if next_statement:
                    scopes.append('arrow' if previous == '=>' else 'block')
                else:
                    scopes.append('object')
            elif token == ')' and scopes[-1] in {'control', 'for', 'group'}:
                next_statement = scopes.pop() != 'group'
            elif token == ']' and scopes[-1] == 'array':
                scopes.pop()
            elif token == '}':
                if scopes[-1] == 'interpolation':
                    return index
                if len(scopes) > 1 and scopes[-1] in {'block', 'object', 'arrow'}:
                    next_statement = scopes.pop() == 'block'
                    if next_statement and scopes[-1] == 'expression body':
                        scopes.pop()
                        next_statement = False
            elif token == '?':
                scopes.append('conditional')
            elif token == ':':
                if scopes[-1] == 'conditional':
                    scopes.pop()
                else:
                    next_statement = scopes[-1] in {'block', 'arrow'}
            elif token in {';', 'else', 'do'}:
                if token == ';' and scopes[-1] == 'for':
                    scopes[-1] = 'control'
                next_statement = True
            elif token == 'await' and previous == 'for':
                token = 'for await'
            elif token == 'of' and scopes[-1] == 'for' and not regex_allowed and previous not in {'let', 'const', 'var'}:
                token = '<for-of separator>'

            if token in {'++', '--'}:
                # The prior token and any intervening line break distinguish prefix from postfix.
                regex_allowed = regex_allowed or line_break
            else:
                regex_allowed = next_statement or token in _EXPRESSION_PREFIXES
            statement = next_statement
            previous, previous_end = token, index

        if template_start is not None:
            raise ValueError(f'Unterminated template literal at offset {template_start}')
        return index


def strip_comments(source: str, suffix: str) -> str:
    """Return the source with ordinary comment spans removed, preserving other bytes."""
    stripper = _CommentStripper(source)
    if suffix == '.js':
        stripper.javascript()
    elif suffix == '.css':
        stripper.css()
    else:
        raise ValueError(f'Unsupported source suffix: {suffix}')
    stripper.parts.append(source[stripper.kept_from:])
    return ''.join(stripper.parts)


def _sources(root):
    return [path for path in root.rglob('*') if path.suffix in {'.js', '.css'} and path.is_file()]


def authored_bytes(root=SOURCE_ROOT):
    """UTF-8 bytes of all JS/CSS under `web/src`, without ordinary comments; whitespace and legal comments count."""
    total = 0
    for path in _sources(root):
        try:
            total += len(strip_comments(path.read_bytes().decode('utf-8'), path.suffix).encode('utf-8'))
        except ValueError as error:
            raise ValueError(f'{path}: {error}') from error
    return total


def packaged_gzip_bytes(root=ASSET_ROOT):
    """Sum of per-file deterministic gzip-9 sizes (`mtime=0`) of all built JS/CSS."""
    return sum(len(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)) for path in _sources(root))


if __name__ == '__main__':
    print(f'Authored JS+CSS without comments: {authored_bytes():,} bytes')
    if _sources(ASSET_ROOT):
        print(f'Packaged gzip-9 JS+CSS: {packaged_gzip_bytes():,} of 65,536 bytes')
    else:
        print('Packaged JS/CSS is not built; run npm --prefix web run build')
