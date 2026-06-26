/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f3f8',
          100: '#d9e0ec',
          200: '#b0c0d9',
          300: '#7895c1',
          400: '#4d6fa8',
          500: '#2d5599',
          600: '#1f4289',
          700: '#1b2f4a',
          800: '#13233a',
          900: '#0D1B2E',
        },
        accent: {
          50:  '#eef4fd',
          100: '#d0dff5',
          200: '#a8c4ec',
          300: '#7aa9df',
          400: '#4e89cc',
          500: '#1e4e8c',
          600: '#1a4478',
          700: '#163a65',
          800: '#103060',
          900: '#0a1f40',
        },
        brand: {
          red:           '#d62828',
          'red-light':   '#f5b8b8',
          'red-dark':    '#9e1c1c',
          gold:          '#f4c542',
          'gold-light':  '#fdf0bc',
          'gold-dark':   '#b89010',
          green:         '#2e7d32',
          'green-light': '#c8e6c9',
          'green-dark':  '#1b5e20',
          blue:          '#1e4e8c',
          'blue-light':  '#d0dff5',
          'blue-dark':   '#103060',
        },
        cta: {
          DEFAULT: '#c2410c',
          hover:   '#ea580c',
        },
        danger: {
          DEFAULT: '#d94f3d',
          dark:    '#9f2f22',
          bg:      '#fdf2f2',
        },
      },
      fontFamily: {
        sans: ['Noto Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
