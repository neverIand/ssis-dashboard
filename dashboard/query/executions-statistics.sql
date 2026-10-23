SET NOCOUNT ON;
DECLARE @hourspan INT = ?;
DECLARE @asOfDate DATETIME2 = NULLIF(?, 'NOW');
DECLARE @folderNamePattern NVARCHAR(100) = ?;
DECLARE @projectNamePattern NVARCHAR(100) = ?;
DECLARE @statusFilter INT = ?;

SET @asOfDate = ISNULL(@asOfDate, SYSDATETIME());

-- The calendar below holds whole dates, from the first to the last hour before @asOfDate.
DECLARE @firstDate DATE = cast(dateadd(hour, -@hourspan, @asOfDate) as date);
DECLARE @lastDate DATE = cast(dateadd(hour, -1, @asOfDate) as date);

-- Count each created date once, before the calendar join: joining per date
-- rescanned every execution for each calendar day. created_time keeps its
-- original offset (at most 14 hours from UTC, and a DATETIME2 bound compares
-- as UTC), so this range is a superset of those dates and the date match
-- below stays exact.
select
	[created_date] = cast(e.created_time as date),
	created_packages = count(e.execution_id),
	executed_packages = sum(case when e.start_time is not null then 1 else 0 end),
	succeeded_packages = sum(case when e.[status] = 7 then 1 else 0 end),
	failed_packages = sum(case when e.[status] = 4 then 1 else 0 end)
into
	#created_dates
from
	[catalog].executions e
where
	e.created_time >= dateadd(hour, -14, cast(@firstDate as datetime2))
and
	e.created_time < dateadd(hour, 24 + 14, cast(@lastDate as datetime2))
and
	e.folder_name like @folderNamePattern
and
	e.project_name like @projectNamePattern
and
	(e.[status] = @statusFilter or @statusFilter = 0)
group by
	cast(e.created_time as date);

with numbers as
(
	select
		n = row_number() over (order by a.object_id)
	from
		sys.all_columns a cross join sys.all_columns b
), calendar as
(
	select distinct
		cast(dateadd(hour, n * -1, @asOfDate) as date) as calendar_date
	from
		numbers
	where
		n <= @hourspan
)
select
	c.[calendar_date],
	created_packages = isnull(d.created_packages, 0),
	executed_packages = isnull(d.executed_packages, 0),
	succeeded_packages = isnull(d.succeeded_packages, 0),
	failed_packages = isnull(d.failed_packages, 0)
from
	calendar c
left join
	#created_dates d on d.created_date = c.calendar_date;
