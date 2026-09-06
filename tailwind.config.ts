import type { Config } from 'tailwindcss'

/**
 * Colours, radii and spacing live as CSS custom properties in
 * src/styles/tokens.css and are referenced here, so a component never reaches
 * for a hex and the light theme is a matter of redefining tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-1': 'var(--color-surface-1)',
        'surface-2': 'var(--color-surface-2)',
        'surface-3': 'var(--color-surface-3)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        glass: 'var(--glass-bg)',
        'glass-edge': 'var(--glass-edge)',
        scrim: 'var(--scrim)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        'text-faint': 'var(--color-text-faint)',
        accent: 'var(--color-accent)',
        'accent-strong': 'var(--color-accent-strong)',
        'accent-soft': 'var(--color-accent-soft)',
        'accent-container': 'var(--color-accent-container)',
        'accent-text': 'var(--color-accent-text)',
        positive: 'var(--color-positive)',
        negative: 'var(--color-negative)'
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
        pill: 'var(--radius-pill)'
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        menu: 'var(--shadow-menu)'
      },
      backdropBlur: {
        glass: 'var(--glass-blur)'
      },
      fontFamily: {
        sans: 'var(--font-sans)'
      },
      /*
       * Material's type scale. Named by role rather than size, so a component
       * says what a piece of text *is* and the scale decides how big that looks.
       */
      fontSize: {
        display: [
          'var(--text-display)',
          { lineHeight: '1.15', letterSpacing: 'var(--text-display-tracking)', fontWeight: '600' }
        ],
        headline: [
          'var(--text-headline)',
          { lineHeight: '1.25', letterSpacing: 'var(--text-headline-tracking)', fontWeight: '600' }
        ],
        title: [
          'var(--text-title)',
          { lineHeight: '1.35', letterSpacing: 'var(--text-title-tracking)', fontWeight: '500' }
        ],
        body: ['var(--text-body)', { lineHeight: '1.5', letterSpacing: 'var(--text-body-tracking)' }],
        label: [
          'var(--text-label)',
          { lineHeight: '1.4', letterSpacing: 'var(--text-label-tracking)', fontWeight: '500' }
        ],

        /*
         * Tailwind's own sizes, restated one step down so they land on the
         * scale above instead of beside it. `text-base` is the interface's
         * body size, not the browser's 16px default — which is the single
         * change that takes the chrome from "enlarged" to "composed", without
         * editing the hundred-odd places that ask for it.
         */
        base: ['var(--text-body)', { lineHeight: '1.5' }],
        sm: ['0.8125rem', { lineHeight: '1.45' }],
        xs: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.02em' }]
      }
    }
  },
  plugins: []
} satisfies Config
