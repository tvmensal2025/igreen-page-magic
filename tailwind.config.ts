import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        heading: ['Montserrat', 'sans-serif'],
        body: ['Open Sans', 'sans-serif'],
        display: ['"Space Grotesk"', 'Montserrat', 'sans-serif'],
        'body-alt': ['"DM Sans"', 'Open Sans', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          text: "hsl(var(--primary-text))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // Paleta local do módulo Produtos/Vendas (Sage & Cream)
        pv: {
          bg: "hsl(var(--pv-bg) / <alpha-value>)",
          surface: "hsl(var(--pv-surface) / <alpha-value>)",
          mid: "hsl(var(--pv-mid) / <alpha-value>)",
          accent: "hsl(var(--pv-accent) / <alpha-value>)",
          ink: "hsl(var(--pv-ink) / <alpha-value>)",
          gold: "hsl(var(--pv-gold) / <alpha-value>)",
          "gold-ink": "hsl(var(--pv-gold-ink) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(30px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-40px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(40px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.9)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "pulse-green": {
          "0%, 100%": { boxShadow: "0 0 20px hsl(130 100% 36% / 0.3)" },
          "50%": { boxShadow: "0 0 60px hsl(130 100% 36% / 0.6)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "counter": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "xp-rise": {
          "0%":   { opacity: "0", transform: "translateY(8px) scale(0.8)" },
          "20%":  { opacity: "1", transform: "translateY(0) scale(1.05)" },
          "70%":  { opacity: "1", transform: "translateY(-30px) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-50px) scale(0.9)" },
        },
        "combo-pop": {
          "0%":   { transform: "scale(0.6) rotate(-6deg)", opacity: "0" },
          "60%":  { transform: "scale(1.15) rotate(2deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0)", opacity: "1" },
        },
        "shimmer-gold": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%":      { backgroundPosition: "100% 50%" },
        },
        "card-flip": {
          "0%":   { transform: "rotateY(0deg)" },
          "100%": { transform: "rotateY(360deg)" },
        },
        "field-flash": {
          "0%":   { boxShadow: "0 0 0 0 hsl(var(--primary) / 0.6)", transform: "scale(1)" },
          "40%":  { boxShadow: "0 0 0 8px hsl(var(--primary) / 0)",   transform: "scale(1.03)" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--primary) / 0)",     transform: "scale(1)" },
        },
        "bg-drift": {
          "0%, 100%": { backgroundPosition: "0% 0%" },
          "50%":      { backgroundPosition: "100% 100%" },
        },
        "boss-pulse": {
          "0%, 100%": { transform: "scale(1)", boxShadow: "0 0 24px hsl(var(--primary)/0.4)" },
          "50%":      { transform: "scale(1.025)", boxShadow: "0 0 48px hsl(45 95% 55%/0.5)" },
        },
        // Executive performance keyframes
        "exec-ticker-rise": {
          "0%":   { opacity: "0", transform: "translateY(12px) scale(0.92)" },
          "30%":  { opacity: "1", transform: "translateY(-4px) scale(1.04)" },
          "60%":  { transform: "translateY(0) scale(1)" },
          "80%":  { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(-28px) scale(0.96)" },
        },
        "exec-reveal": {
          "0%":   { opacity: "0", transform: "scale(0.88) translateY(16px)" },
          "60%":  { opacity: "1", transform: "scale(1.02) translateY(-2px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "exec-rank-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(45 85% 52% / 0)" },
          "50%":      { boxShadow: "0 0 0 6px hsl(45 85% 52% / 0.2)" },
        },
        "exec-energy": {
          "0%":   { transform: "scaleY(1)", opacity: "0.7" },
          "50%":  { transform: "scaleY(1.08)", opacity: "1" },
          "100%": { transform: "scaleY(1)", opacity: "0.7" },
        },
        "exec-card-in": {
          "0%":   { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "exec-float-up": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "20%":  { opacity: "1", transform: "translateY(0)" },
          "75%":  { opacity: "1", transform: "translateY(-20px)" },
          "100%": { opacity: "0", transform: "translateY(-36px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.6s ease-out forwards",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "slide-in-left": "slide-in-left 0.6s ease-out forwards",
        "slide-in-right": "slide-in-right 0.6s ease-out forwards",
        "scale-in": "scale-in 0.5s ease-out forwards",
        "pulse-green": "pulse-green 2s ease-in-out infinite",
        "float": "float 3s ease-in-out infinite",
        "counter": "counter 0.8s ease-out forwards",
        "xp-rise": "xp-rise 1.4s ease-out forwards",
        "combo-pop": "combo-pop 0.4s cubic-bezier(.34,1.56,.64,1) forwards",
        "shimmer-gold": "shimmer-gold 4s ease-in-out infinite",
        "card-flip": "card-flip 0.6s ease-in-out",
        "field-flash": "field-flash 0.6s ease-out",
        "bg-drift": "bg-drift 14s ease-in-out infinite",
        "boss-pulse": "boss-pulse 1.8s ease-in-out infinite",
        // Executive performance animations
        "exec-ticker": "exec-ticker-rise 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "exec-reveal": "exec-reveal 0.55s cubic-bezier(0.34, 1.4, 0.64, 1) forwards",
        "exec-rank": "exec-rank-pulse 2s ease-in-out 3",
        "exec-energy": "exec-energy 1.8s ease-in-out infinite",
        "exec-card": "exec-card-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "exec-float": "exec-float-up 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
