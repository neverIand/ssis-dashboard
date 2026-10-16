SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @take int = ?, @upper bigint = ?, @last bigint = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(int, NULL) AS page_empty WHERE 1 = 0;
    RETURN;
END;

DECLARE @value_page TABLE (execution_parameter_id bigint NOT NULL PRIMARY KEY);
INSERT @value_page
SELECT TOP (@take) execution_parameter_id FROM catalog.execution_parameter_values
WHERE execution_id = @execution_id AND execution_parameter_id <= @upper
  AND execution_parameter_id > ISNULL(@last, CONVERT(bigint, 0))
ORDER BY execution_parameter_id ASC;

DECLARE @value_rows TABLE (
    execution_parameter_id bigint NOT NULL PRIMARY KEY, object_type smallint NOT NULL,
    name nvarchar(128) NOT NULL, sql_type nvarchar(128) NOT NULL,
    sensitive bit NOT NULL, [required] bit NOT NULL, value_set bit NOT NULL, runtime_override bit NOT NULL,
    value nvarchar(max) NULL
);
INSERT @value_rows
SELECT p.execution_parameter_id, p.object_type, p.parameter_name, p.parameter_data_type,
       p.sensitive, p.[required], p.value_set, p.runtime_override,
       -- sql_variant is intrinsically bounded. Never fetch its raw value via ODBC.
       -- Preserve float precision and binary bytes; style 126 preserves date/time.
       CASE CONVERT(nvarchar(128), SQL_VARIANT_PROPERTY(v.permitted_value, 'BaseType'))
           WHEN N'float' THEN CONVERT(nvarchar(max), CONVERT(float, v.permitted_value), 3)
           WHEN N'real' THEN CONVERT(nvarchar(max), CONVERT(real, v.permitted_value), 3)
           WHEN N'binary' THEN CONVERT(nvarchar(max), CONVERT(varbinary(8000), v.permitted_value), 1)
           WHEN N'varbinary' THEN CONVERT(nvarchar(max), CONVERT(varbinary(8000), v.permitted_value), 1)
           ELSE CONVERT(nvarchar(max), v.permitted_value, 126)
       END
FROM @value_page AS selected JOIN catalog.execution_parameter_values AS p
    ON p.execution_id = @execution_id AND p.execution_parameter_id = selected.execution_parameter_id
CROSS APPLY (SELECT CASE WHEN p.sensitive = 0 THEN p.parameter_value END AS permitted_value) AS v;

SELECT CASE WHEN r.execution_parameter_id IS NULL THEN 1 ELSE 0 END AS page_empty,
       visible.execution_id, r.*
FROM catalog.executions AS visible LEFT JOIN @value_rows AS r ON 1 = 1
WHERE visible.execution_id = @execution_id
ORDER BY r.execution_parameter_id ASC;
