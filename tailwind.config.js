/** @type {import('tailwindcss').Config} */
// The design tokens of docs/design-system.md ("Bold Sport"). The v1 cream/terracotta
// palette and Fraunces are gone: this app is dark everywhere, with one hot accent.
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: "#121418",
        card: "#1C1F25",
        track: "#2A2E36",
        line: "#23262D",
        ink: "#F3F1EC",
        mute: "#8B8F98",
        dim: "#5C6069",
        accent: "#FF7A1A",
        good: "#3DD68C",
      },
      fontFamily: {
        // Barlow for text, Barlow Condensed for display. Loaded in app/_layout.tsx.
        sans: ["Barlow_400Regular"],
        medium: ["Barlow_500Medium"],
        semi: ["Barlow_600SemiBold"],
        disp: ["BarlowCondensed_700Bold"],
        "disp-semi": ["BarlowCondensed_600SemiBold"],
      },
      borderRadius: {
        card: "20px",
        tile: "14px",
        thumb: "10px",
      },
    },
  },
  plugins: [],
};
