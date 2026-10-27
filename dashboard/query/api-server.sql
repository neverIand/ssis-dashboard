-- The existing legacy operational label, without SQL/service/login identity details.
SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS server_name;
