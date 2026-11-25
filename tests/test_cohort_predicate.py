"""The execution cohort predicate is written once per SQL statement; its copies must stay identical.

The list fence, the ID page (twice), the ordered page, the calculated sort, the summary and the timeline
each filter the same created-time cohort (decision D1/Q1 of the 9 and 10 November reviews). The summary
counts every status, so only its status line is absent.
"""

from importlib.resources import files
import re
import unittest

from dashboard.db import load_query


FILES = ('api-executions-fence.sql', 'api-executions-page.sql', 'api-executions-ordered-page.sql',
         'api-executions-sort.sql', 'api-metrics-summary.sql', 'api-metrics-timeline.sql')
PREDICATE = '''WHERE e.created_time >= @from AND e.created_time < @to
AND (@folder IS NULL OR e.folder_name = @folder)
AND (@project IS NULL OR e.project_name = @project)
AND (@package IS NULL OR e.package_name = @package)
AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')'''
STATUS = 'AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))'
# Each statement may add only its own ID fence and seek after the cohort; nothing else filters the cohort.
SEEKS = {
    'api-executions-fence.sql': [[]],
    'api-executions-page.sql': [
        ['AND e.execution_id <= CASE WHEN @last IS NULL OR @last > @upper THEN @upper ELSE @last - 1 END'],
        ['AND e.execution_id <= @upper', 'AND e.execution_id > ISNULL(@last,CONVERT(bigint,0))']],
    'api-executions-ordered-page.sql': [['AND e.execution_id <= @upper']],
    'api-executions-sort.sql': [['AND e.execution_id <= @upper']],
    'api-metrics-summary.sql': [[]],
    'api-metrics-timeline.sql': [[]],
}
DECLARATIONS = '''@from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
@to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
@folder nvarchar(128) = ?, @project nvarchar(128) = ?, @package nvarchar(260) = ?,
@folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?'''
STATUS_DECLARATIONS = '''@s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
@s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?'''


def lines(text):
    """Indentation differs between statements; the words may not."""
    return '\n'.join(line.strip() for line in text.splitlines() if line.strip())


_CLAUSE_END = re.compile(r' (GROUP BY|ORDER BY|HAVING|OPTION|UNION|EXCEPT|INTERSECT|SELECT|FROM)\b', re.I)


def without_comments(sql):
    """T-SQL comments read left to right, as the server lexes them: `--` to the end of the line, nested
    `/* */` blocks, and neither inside a quoted string or identifier ('…', "…", […])."""
    out, index, closing = [], 0, {"'": "'", '"': '"', '[': ']'}
    while index < len(sql):
        if sql.startswith('--', index):
            end = sql.find('\n', index)
            index = len(sql) if end < 0 else end
            out.append(' ')
        elif sql.startswith('/*', index):
            depth, index = 1, index + 2
            while index < len(sql) and depth:
                if sql.startswith('/*', index):
                    depth, index = depth + 1, index + 2
                elif sql.startswith('*/', index):
                    depth, index = depth - 1, index + 2
                else:
                    index += 1
            out.append(' ')
        elif sql[index] in closing:
            end = closing[sql[index]]
            start, index = index, index + 1
            while index < len(sql):
                if sql[index] == end:
                    if sql.startswith(end * 2, index):  # a doubled quote or bracket is part of the text
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            out.append(sql[start:index])
        else:
            out.append(sql[index])
            index += 1
    return ''.join(out)


def where_clauses(sql):
    """Each WHERE clause that filters the cohort, whole: comments removed, whitespace collapsed, and cut
    at the end of its statement or subquery (`;` or a closing parenthesis at its own depth) or at the next
    clause keyword at its own depth, in any letter case."""
    text = ' '.join(without_comments(sql).split())
    for match in re.finditer(r'\bWHERE e\.created_time\b', text, re.I):
        depth, index = 0, match.start()
        while index < len(text):
            char = text[index]
            if char == '(':
                depth += 1
            elif char == ')':
                if depth == 0:
                    break
                depth -= 1
            elif depth == 0 and (char == ';' or _CLAUSE_END.match(text, index)):
                break
            index += 1
        yield text[match.start():index].strip()


class CohortPredicateTests(unittest.TestCase):
    def test_seven_predicates_in_six_files_are_identical(self):
        found = 0
        for name in FILES:
            with self.subTest(name=name):
                clauses = list(where_clauses(load_query(name)))
                status = [] if name == 'api-metrics-summary.sql' else [STATUS]
                self.assertEqual(clauses, [' '.join([*PREDICATE.split('\n'), *status, *seek]) for seek in SEEKS[name]])
                found += len(clauses)
        self.assertEqual(found, 7)

    def test_cohort_parameters_are_declared_with_one_type_each(self):
        for name in FILES:
            with self.subTest(name=name):
                text = lines(load_query(name))
                self.assertEqual(text.count(DECLARATIONS), 1)
                # The list follows with paging variables (,) or ends (;).
                self.assertEqual(len(re.findall(re.escape(STATUS_DECLARATIONS) + '[,;]', text)),
                                 int(name != 'api-metrics-summary.sql'))

    def test_no_other_resource_filters_the_execution_cohort(self):
        others = [path.name for path in files('dashboard').joinpath('query').iterdir()
                  if path.name.endswith('.sql') and path.name not in FILES
                  and '@folder_pattern' in path.read_text(encoding='utf-8-sig')]
        self.assertEqual(others, [])


if __name__ == '__main__':
    unittest.main()
