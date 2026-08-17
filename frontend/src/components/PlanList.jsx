import { PlanCard } from './PlanCard.jsx';

export function PlanList({ plans }) {
  return <div className="plan-grid">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>;
}
