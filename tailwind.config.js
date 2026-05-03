/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        paper: "#FFFFFF",
        ink: "#1A1714",
        graphite: "#5C544B",
        ash: "#9A938A",
        mist: "#C9C2B8",
        hairline: "#E8E1D6",
        terracotta: "#B8623E",
        clay: "#D9876A",
        sage: "#7A8C6F",
      },
      fontFamily: {
        serif: ["Fraunces_500Medium"],
        "serif-light": ["Fraunces_300Light"],
        "serif-bold": ["Fraunces_600SemiBold"],
      },
      letterSpacing: {
        widest: "0.25em",
      },
    },
  },
  plugins: [],
};
