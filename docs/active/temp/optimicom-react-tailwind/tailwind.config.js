/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        rounded: ['ui-rounded', '"SF Pro Rounded"', '"Hiragino Maru Gothic ProN"', '"Yu Gothic"', 'Meiryo', 'sans-serif'],
      },
      colors: {
        ink: '#17335F',
        'ink-soft': '#536B8D',
        muted: '#8192AA',
        sky: '#4EC8F7',
        'sky-deep': '#229CDE',
        cyan: '#6BE2E5',
        pink: '#FF5F98',
        'pink-soft': '#FFA7C2',
        yellow: '#FFD76A',
        mint: '#8EE6C2',
        lav: '#D8CBFF',
        peach: '#FFD8B3',
        paper: '#F6FBFF',
        line: '#DDEAF4',
        'line-strong': '#C9E0F1',
        good: '#24B47E',
        bad: '#E85678',
      },
      boxShadow: {
        soft: '0 8px 24px rgba(63,101,143,.09)',
        panel: '0 16px 38px rgba(63,101,143,.11),0 2px 10px rgba(63,101,143,.06)',
      },
    },
  },
  plugins: [],
}
