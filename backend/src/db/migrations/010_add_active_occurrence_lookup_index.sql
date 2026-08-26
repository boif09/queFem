CREATE INDEX idx_plan_occurrences_source_status_date_time
ON plan_occurrences(plan_source_id, status, local_date, local_time);
