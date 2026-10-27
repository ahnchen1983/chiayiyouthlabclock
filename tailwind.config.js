/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './contexts/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-green-dark': '#2E7D32',
        'brand-green-light': '#4CAF50',
        'brand-blue-dark': '#1565C0',
        'bg-closed': '#FFCDD2',
        'bg-wed-thu': '#E3F2FD',
        'bg-fri-sun': '#FFF3E0',
        'alert-yellow': '#FFEB3B',
        'status-success': '#2E7D32',
        'status-error': '#C62828',
        'status-warn': '#FF9800',
      },
    },
  },
  plugins: [],
};
