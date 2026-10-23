SET NOCOUNT ON;
DECLARE @hourspan INT = ?;
DECLARE @asOfDate DATETIME2 = NULLIF(?, 'NOW');
DECLARE @folderNamePattern NVARCHAR(100) = ?;
DECLARE @projectNamePattern NVARCHAR(100) = ?;
DECLARE @statusFilter INT = ?;
DECLARE @executionCount INT = ?;

SET @asOfDate = ISNULL(@asOfDate, SYSDATETIME());

-- Select the listed executions first. Counting events before this step read
-- the whole retained event history on every overview load.
select top (@executionCount)
	e.execution_id,
	e.project_name,
	e.package_name,
	e.project_lsn,
	e.environment_folder_name,
	e.environment_name,
	e.status,
	e.start_time,
	e.end_time
into
	#listed
from
	[catalog].executions e
where
	e.folder_name like @folderNamePattern
and
	e.project_name like @projectNamePattern
and
	e.created_time >= dateadd(hour, -@hourspan, @asOfDate)
and
	(e.[status] = @statusFilter or @statusFilter = 0)
order by
	e.execution_id desc
option
	(recompile);

-- Count only the listed executions' events. FORCE ORDER keeps the listed IDs
-- ahead of the event view's permission joins, as in the API page counts. A
-- category without events stays NULL, as with the former PIVOT.
select
	e.execution_id,
	[errors] = nullif(sum(case when m.event_name = 'OnError' then 1 else 0 end), 0),
	warnings = nullif(sum(case when m.event_name = 'OnWarning' then 1 else 0 end), 0)
into
	#listed_events
from
	#listed e
left outer join
	[catalog].event_messages m on m.operation_id = e.execution_id and m.event_name in ('OnError', 'OnWarning')
group by
	e.execution_id
option
	(force order);

-- Read logging levels in their own listed-first statement too; joined in the
-- final select, a whole-view scan of parameter values ran single-threaded.
-- Only the system parameter: a project/package parameter can share the name
-- and hold text. The CASE keeps the conversion behind the filter, because
-- SQL Server may evaluate SELECT expressions before WHERE.
select
	e.execution_id,
	logging_level = convert(int, case when v.object_type = 50 and v.parameter_name = N'LOGGING_LEVEL' then v.parameter_value end)
into
	#listed_levels
from
	#listed e
inner join
	[catalog].[execution_parameter_values] v on v.execution_id = e.execution_id
where
	v.object_type = 50
and
	v.parameter_name = N'LOGGING_LEVEL'
option
	(force order);

select
	e.execution_id,
	e.project_name,
	e.package_name,
	e.project_lsn,
	environment = isnull(e.environment_folder_name, '') + isnull('\' + e.environment_name,  ''),
	e.status,
	start_time = format(e.start_time, 'yyyy-MM-dd HH:mm:ss'),
	end_time = format(e.end_time, 'yyyy-MM-dd HH:mm:ss'),
	elapsed_time_min = format(datediff(ss, e.start_time, e.end_time) / 60., '#,0.00'),
	k.warnings,
	k.errors,
	l.logging_level
from
	#listed e
inner join
	#listed_events k on e.execution_id = k.execution_id
left outer join
	#listed_levels l on e.execution_id = l.execution_id
order by
	e.execution_id desc;
