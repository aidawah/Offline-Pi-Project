/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/js/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        'panel': 'rgba(12, 24, 18, 0.9)',
        'accent': '#f97316',
        'accent2': '#7dd3a5',
        'accent-warn': '#fbbf24',
        'accent-hot': '#ef4444',
      },
      animation: {
        'temp-pulse': 'tempPulse 3s ease-in-out infinite',
        'card-float': 'cardFloat 4s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
        'rotate-slow': 'rotate 10s linear infinite',
        'rotate-slower': 'rotate 20s linear infinite',
        'weather-pulse': 'weatherStationPulse 3s ease-in-out infinite',
        'icon-bounce': 'iconBounce 2s ease-in-out infinite',
        'data-flicker': 'dataFlicker 2s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 6s ease-in-out infinite',
        'pulse-glow-mini': 'pulseGlow 5s ease-in-out infinite',
        'digit-roll': 'digitRoll 0.5s ease-out',
      },
      keyframes: {
        tempPulse: {
          '0%, 100%': {
            transform: 'scale(1)',
            textShadow: '0 0 10px rgba(59, 130, 246, 0.3)',
          },
          '50%': {
            transform: 'scale(1.02)',
            textShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
          },
        },
        cardFloat: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        fadeInUp: {
          from: {
            opacity: '0',
            transform: 'translateY(20px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        rotate: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        weatherStationPulse: {
          '0%, 100%': {
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55), 0 0 20px rgba(59, 130, 246, 0.2)',
          },
          '50%': {
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55), 0 0 40px rgba(59, 130, 246, 0.4)',
          },
        },
        iconBounce: {
          '0%, 100%': {
            transform: 'translateY(0) scale(1)',
          },
          '50%': {
            transform: 'translateY(-3px) scale(1.05)',
          },
        },
        dataFlicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.95' },
        },
        pulseGlow: {
          '0%, 100%': {
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(34, 211, 238, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 4px rgba(0, 0, 0, 0.5)',
          },
          '50%': {
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4), 0 0 40px rgba(34, 211, 238, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.15), inset 0 -1px 4px rgba(0, 0, 0, 0.5)',
          },
        },
        digitRoll: {
          from: {
            transform: 'translateY(-10px)',
            opacity: '0',
          },
          to: {
            transform: 'translateY(0)',
            opacity: '1',
          },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};
