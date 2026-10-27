export function Spinner({
    size = 'md',
    className = '',
}: {
    size?: 'sm' | 'md' | 'lg'
    className?: string
}) {
    const dim = {
        sm: 'w-5 h-5',
        md: 'w-8 h-8',
        lg: 'w-10 h-10',
    }[size]

    return (
        <svg
            className={`animate-spin text-white ${dim} ${className}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            role="status"
            aria-label="Caricamento"
            style={{ willChange: 'transform', transformOrigin: 'center' }}
        >
            <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
            />
            <path
                className="opacity-80"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
        </svg>
    )
}

export function PageSpinner() {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center">
            <Spinner />
        </div>
    )
}
