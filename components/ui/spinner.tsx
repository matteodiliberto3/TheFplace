export function Spinner({
    size = 'md',
    className = '',
}: {
    size?: 'sm' | 'md' | 'lg'
    className?: string
}) {
    const dim = {
        sm: 'w-5 h-5',
        md: 'w-7 h-7',
        lg: 'w-9 h-9',
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
            {/* Traccia circolare uniforme sottile (identica a border-2 border-white/20) */}
            <circle
                className="opacity-20"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
            />
            {/* Quarto di cerchio superiore bianco puro (identico a border-t-white, senza cunei o asimmetrie) */}
            <circle
                className="opacity-100"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="15.71 47.13"
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
