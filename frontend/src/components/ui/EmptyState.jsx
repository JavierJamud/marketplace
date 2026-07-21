export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-outline-variant py-16 text-center">
      {Icon && <Icon className="h-10 w-10 text-outline" strokeWidth={1.5} />}
      <p className="text-title-lg text-on-surface">{title}</p>
      {description && <p className="max-w-sm text-body-md text-on-surface-variant">{description}</p>}
      {action}
    </div>
  );
}
