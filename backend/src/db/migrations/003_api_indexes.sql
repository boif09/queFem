CREATE INDEX IF NOT EXISTS idx_plans_status_quality
ON plans(status, quality_score);

CREATE INDEX IF NOT EXISTS idx_plans_status_comarca_quality
ON plans(status, comarca, quality_score);

CREATE INDEX IF NOT EXISTS idx_plans_status_municipality_quality
ON plans(status, municipality, quality_score);

CREATE INDEX IF NOT EXISTS idx_plan_categories_category_plan
ON plan_categories(category_id, plan_id);
