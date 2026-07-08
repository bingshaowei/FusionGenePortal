/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",   // 如果你的组件放在 src 目录下
    "./public/index.html"           // 有时也要处理 public/index.html
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1e40af",  // 可以自定义颜色
        secondary: "#4f46e5"
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif']
      }
    },
  },
  plugins: [],
};

