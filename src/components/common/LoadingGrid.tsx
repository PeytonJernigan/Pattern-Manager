interface LoadingGridProps {
  count?: number
}

export function LoadingGrid({ count = 6 }: LoadingGridProps) {
  return (
    <div className="loading-grid" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-card" key={index} aria-hidden="true">
          <span />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  )
}
