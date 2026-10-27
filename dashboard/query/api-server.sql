-- Match the legacy display label without querying service/login details.
IF (SERVERPROPERTY('EDITION') = 'SQL Azure')
    SELECT CONVERT(nvarchar(128), N'DEMO') AS server_name;
ELSE
    EXEC(N'SELECT CONVERT(nvarchar(128), @@SERVERNAME) AS server_name;');
