export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description ? <p className="muted" style={{ margin: 0 }}>{description}</p> : null}
    </div>
  );
}
