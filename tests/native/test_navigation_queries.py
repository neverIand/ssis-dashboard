"""Execute the package-list SQL (History suggestions, F2) against temporary catalog sources.

Every chain, in both sorts and directions and at several page sizes, is compared with an
independent full-result query under the same collation: case and trailing-space ties,
accents, wide Unicode names, same names in other projects and folders, and the ID fence.
As in SSISDB, folder names are unique and project names are unique within a folder.
"""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import pyodbc

from dashboard import create_app
from dashboard.db import load_query


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
# Catalog name columns use the SSISDB collation; DATABASE_DEFAULT gives the temporary copies the same one.
# The unique keys are those of internal.folders (name) and internal.projects (name, folder_id).
SOURCES = """
CREATE TABLE #n_folders(folder_id bigint PRIMARY KEY, name nvarchar(128) COLLATE DATABASE_DEFAULT NOT NULL UNIQUE,
 description nvarchar(1024) COLLATE DATABASE_DEFAULT);
CREATE TABLE #n_projects(project_id bigint PRIMARY KEY, folder_id bigint NOT NULL,
 name nvarchar(128) COLLATE DATABASE_DEFAULT NOT NULL, description nvarchar(1024) COLLATE DATABASE_DEFAULT,
 UNIQUE (name, folder_id));
CREATE TABLE #n_packages(package_id bigint PRIMARY KEY, project_id bigint NOT NULL,
 name nvarchar(260) COLLATE DATABASE_DEFAULT NOT NULL, description nvarchar(1024) COLLATE DATABASE_DEFAULT);
INSERT #n_folders VALUES (1, N'Finance', NULL), (2, N'Marketing', N'Same project name'), (3, N'Other', N'');
INSERT #n_projects VALUES (10, 1, N'Load', NULL), (11, 1, N'load2', NULL), (20, 2, N'Load', NULL),
 (30, 3, N'Load', NULL), (9223372036854775806, 3, N'Big', NULL);
"""
NAMES = ['Alpha.dtsx', 'alpha.dtsx', 'ALPHA.dtsx ', 'Älpha.dtsx', 'alpha_1.dtsx', 'Beta.dtsx', '%_[x].dtsx',
         "O'Brien.dtsx", '東京.dtsx', '😀' * 130, 'p' * 260, 'Zeta.dtsx', 'zeta.dtsx']
COLUMNS = ['package_id', 'project_id', 'project_name', 'folder_id', 'folder_name', 'name', 'description']
ORACLE = """SELECT p.package_id AS package_id, pr.project_id AS project_id, pr.name AS project_name,
 f.folder_id AS folder_id, f.name AS folder_name, p.name AS name, p.description AS description
FROM #n_packages AS p INNER JOIN #n_projects AS pr ON pr.project_id = p.project_id
INNER JOIN #n_folders AS f ON f.folder_id = pr.folder_id
WHERE f.name = ? AND pr.name = ? ORDER BY {order}"""


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class PackageNavigationSQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.run_batch(SOURCES)
        rows = []
        for project in (10, 20, 30):
            for index, name in enumerate(NAMES):
                description = (None, '', 'Package <text>')[index % 3]
                rows.append((project * 100 + index, project, name, description))
        # A package in a sibling project of the same folder never appears in the Load list.
        rows.append((1150, 11, 'Alpha.dtsx', None))
        rows.append((9223372036854775807, 9223372036854775806, 'Big.dtsx', None))
        self.cursor.executemany('INSERT #n_packages VALUES (?, ?, ?, ?)', rows)

    def run_batch(self, sql, parameters=()):
        self.cursor.execute(sql, tuple(pyodbc.BinaryNull if p is None else p for p in parameters))
        rows = []
        while True:
            if self.cursor.description:
                names = [c[0] for c in self.cursor.description]
                rows = [dict(zip(names, row)) for row in self.cursor.fetchall()]
            if not self.cursor.nextset():
                return rows

    def query(self, resource, parameters):
        sql = load_query(resource)
        for source, target in (('catalog.packages', '#n_packages'), ('catalog.projects', '#n_projects'),
                               ('catalog.folders', '#n_folders')):
            sql = sql.replace(source, target)
        self.assertNotIn('catalog.', sql)
        return self.run_batch(sql, parameters)

    def chain(self, folder, project, *, by_name, descending, take, upper=None):
        if upper is None:
            upper = self.query('api-packages-fence.sql', (folder, project))[0]['upper_id']
        if upper is None:
            return [], None
        actual, last, last_name = [], None, None
        for _ in range(100):
            rows = self.query('api-packages-page.sql', (folder, project, take + 1, upper, last, last_name,
                                                        int(by_name), int(descending)))
            self.assertLessEqual(len(rows), take + 1)
            page = rows[:take]
            actual.extend(page)
            if len(rows) <= take:
                return actual, upper
            last, last_name = page[-1]['package_id'], page[-1]['name']
        self.fail('Unbounded or non-progressing cursor chain')

    def oracle(self, folder, project, *, by_name, descending):
        """Every package of the scope, independently of the fence the tested SQL returned."""
        direction = 'DESC' if descending else 'ASC'
        order = (f'p.name {direction}, ' if by_name else '') + f'p.package_id {direction}'
        return self.run_batch(ORACLE.format(order=order), (folder, project))

    def test_every_chain_matches_the_independent_order_with_collation_ties(self):
        for folder, project in (('Finance', 'Load'), ('FINANCE ', 'LOAD'), ('Other', 'Load')):
            for by_name in (True, False):
                for descending in (False, True):
                    for take in (1, 2, 5, 50):
                        with self.subTest(folder=folder, project=project, by_name=by_name, descending=descending,
                                          take=take):
                            actual, upper = self.chain(folder, project, by_name=by_name, descending=descending,
                                                       take=take)
                            expected = self.oracle(folder, project, by_name=by_name, descending=descending)
                            self.assertEqual(upper, max((r['package_id'] for r in expected), default=None))
                            # Letter case matches only under a case-insensitive catalog collation; the
                            # independent query decides, so only the exact-case scopes have a fixed count.
                            if folder.strip() != folder.strip().upper():
                                self.assertEqual(len(expected), len(NAMES))
                            self.assertEqual([[r[c] for c in COLUMNS] for r in actual],
                                             [[r[c] for c in COLUMNS] for r in expected])

    def test_exact_scope_follows_catalog_collation_and_keeps_parent_identity(self):
        # Trailing spaces never count in SQL Server name comparisons; rows carry the catalog's own names.
        rows, _ = self.chain('Finance ', 'Load', by_name=False, descending=False, take=200)
        self.assertEqual({(r['folder_id'], r['folder_name'], r['project_id'], r['project_name']) for r in rows},
                         {(1, 'Finance', 10, 'Load')})
        self.assertNotIn(1150, [r['package_id'] for r in rows])
        wide = [r for r in rows if r['name'] in ('😀' * 130, 'p' * 260)]
        self.assertEqual(len(wide), 2)
        big, _ = self.chain('Other', 'Big', by_name=True, descending=False, take=1)
        self.assertEqual([(r['package_id'], r['project_id']) for r in big],
                         [(9223372036854775807, 9223372036854775806)])

    def test_missing_scopes_have_no_fence_and_no_rows(self):
        for folder, project in (('Finance', 'Missing'), ('Missing', 'Load'), ('Other', 'load2'),
                                ("x' OR 1=1 --", 'Load')):
            with self.subTest(folder=folder, project=project):
                self.assertEqual(self.query('api-packages-fence.sql', (folder, project)), [{'upper_id': None}])

    def test_continuations_return_nothing_for_missing_or_hidden_scopes(self):
        _, upper = self.chain('Finance', 'Load', by_name=True, descending=False, take=200)
        for folder, project in (('Finance', 'Missing'), ('Other', 'Load2'), ('Missing', 'Load')):
            with self.subTest(folder=folder, project=project):
                self.assertEqual(self.query('api-packages-page.sql', (folder, project, 51, upper, None, None, 1, 0)), [])
        # A folder or project that is no longer visible ends the chain with an empty page.
        for hide in ("DELETE #n_folders WHERE folder_id = 1;", "DELETE #n_projects WHERE project_id = 10;"):
            with self.subTest(hide=hide):
                self.run_batch('SAVE TRANSACTION hide; ' + hide)  # the connection's open transaction
                try:
                    rows = self.query('api-packages-page.sql', ('Finance', 'Load', 51, upper, 100, 'Alpha.dtsx', 1, 0))
                finally:
                    self.run_batch('ROLLBACK TRANSACTION hide;')
                self.assertEqual(rows, [])

    def test_a_parent_hidden_between_the_two_statements_hides_the_packages(self):
        # Delete the parent rows inside the batch, after the first statement has resolved the project ID:
        # the statement that reads packages must check visibility itself.
        _, upper = self.chain('Finance', 'Load', by_name=True, descending=False, take=200)
        for hide in ('DELETE #n_folders WHERE folder_id = 1;', 'DELETE #n_projects WHERE project_id = 10;'):
            for resource, marker, parameters, expected in (
                    ('api-packages-fence.sql', 'SELECT MAX(', ('Finance', 'Load'), [{'upper_id': None}]),
                    ('api-packages-page.sql', '-- Unique aliases', ('Finance', 'Load', 51, upper, None, None, 1, 0), [])):
                with self.subTest(hide=hide, resource=resource):
                    original = load_query
                    def between(name, hide=hide, marker=marker):
                        sql = original(name)
                        self.assertEqual(sql.count(marker), 1)
                        return sql.replace(marker, hide + '\n' + marker)
                    self.run_batch('SAVE TRANSACTION hide;')
                    try:
                        with patch(f'{__name__}.load_query', between):
                            rows = self.query(resource, parameters)
                    finally:
                        self.run_batch('ROLLBACK TRANSACTION hide;')
                    self.assertEqual(rows, expected)

    def test_the_fence_excludes_packages_added_after_the_first_page(self):
        first, upper = self.chain('Other', 'Load', by_name=True, descending=False, take=200)
        self.run_batch("INSERT #n_packages VALUES (9000, 30, N'AAA.dtsx', NULL);")
        again, _ = self.chain('Other', 'Load', by_name=True, descending=False, take=3, upper=upper)
        self.assertEqual([r['package_id'] for r in again], [r['package_id'] for r in first])
        fresh, _ = self.chain('Other', 'Load', by_name=False, descending=True, take=1)
        self.assertEqual(fresh[0]['package_id'], 9000)


if __name__ == '__main__':
    unittest.main()
