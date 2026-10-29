export function Spinner({
    size = 'md',
    className = '',
}: {
    size?: 'sm' | 'md' | 'lg'
    className?: string
}) {
    const dim = {
        sm: 'w-5 h-5 border-2',
        md: 'w-7 h-7 border-2',
        lg: 'w-9 h-9 border-2',
    }[size]

    return (
        <div
            className={`rounded-full border-white/20 border-t-white animate-spin ${dim} ${className}`}
            role="status"
            aria-label="Caricamento"
            style={{ willChange: 'transform' }}
        />
    )
}

export function PageSpinner() {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center">
            <Spinner />
        </div>
    )
}
