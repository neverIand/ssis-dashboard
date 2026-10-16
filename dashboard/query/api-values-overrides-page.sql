SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @take int = ?, @upper bigint = ?, @last bigint = ?, @show bit = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(int, NULL) AS page_empty WHERE 1 = 0;
    RETURN;
END;

DECLARE @value_page TABLE (property_id bigint NOT NULL PRIMARY KEY);
INSERT @value_page
SELECT TOP (@take) property_id FROM catalog.execution_property_override_values
WHERE execution_id = @execution_id AND property_id <= @upper
  AND property_id > ISNULL(@last, CONVERT(bigint, 0))
ORDER BY property_id ASC;

DECLARE @value_rows TABLE (
    property_id bigint NOT NULL PRIMARY KEY, property_path nvarchar(4000) NOT NULL,
    sensitive bit NOT NULL, value nvarchar(max) NULL
);
INSERT @value_rows
SELECT p.property_id, p.property_path, p.sensitive,
       -- Bound UTF-16 explicitly; native SC LEFT can split a pair near 64 KiB.
       CASE WHEN DATALENGTH(v.permitted_value) > 65540
                  AND UNICODE(RIGHT(b.prefix, 1)) BETWEEN 55296 AND 56319
            THEN LEFT(b.prefix, 32769) ELSE b.prefix END
FROM @value_page AS selected JOIN catalog.execution_property_override_values AS p
    ON p.execution_id = @execution_id AND p.property_id = selected.property_id
CROSS APPLY (SELECT CASE WHEN @show = 1 AND p.sensitive = 0 THEN p.property_value END AS permitted_value) AS v
CROSS APPLY (SELECT LEFT(v.permitted_value COLLATE Latin1_General_100_BIN2, 32770) AS prefix) AS b;

SELECT CASE WHEN r.property_id IS NULL THEN 1 ELSE 0 END AS page_empty,
       visible.execution_id, r.*
FROM catalog.executions AS visible LEFT JOIN @value_rows AS r ON 1 = 1
WHERE visible.execution_id = @execution_id
ORDER BY r.property_id ASC;
