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
        ]
      }
    }
  },
  plugins: []
} satisfies Config
