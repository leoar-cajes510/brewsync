interface LoadingStateProps {
  label?: string;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export default function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
