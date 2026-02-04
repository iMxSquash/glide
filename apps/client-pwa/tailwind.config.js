/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}'
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                background: '#0E0F12',
                surface: '#16181D',
                'surface-light': '#1C1E24',
                primary: '#F2F2F3',
                secondary: '#9A9DA3',
                disabled: '#6B6E75',
                accent: '#6EE7B7',
                'accent-secondary': '#A5B4FC',
                error: '#EF4444'
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Manrope', 'sans-serif']
            },
            borderRadius: {
                'xl': '12px',
                '2xl': '16px'
            }
        }
    },
    plugins: []
};
