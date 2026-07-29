---
name: Enterprise Luxury
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#515f74'
  on-secondary: '#ffffff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#57657b'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  code-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
---

## Brand & Style
The design system embodies a "High-End Enterprise" personality—sophisticated, authoritative, yet remarkably fluid. It targets executive-level users and specialized professionals who require clarity without sacrificing aesthetic prestige. 

The visual style is a fusion of **Modern Minimalism** and **Glassmorphism**. It leverages expansive whitespace to signal premium quality, moving away from dense, data-heavy layouts toward a breathable, "gallery-like" experience for enterprise data. The interface feels lightweight and architectural, using translucency and precision-engineered typography to establish a calm, professional atmosphere.

## Colors
The palette is built on a foundation of "Deep Slate" and "Cool Grays," providing a cinematic depth that flat neutrals cannot achieve. 

- **Primary & Secondary:** Use deep slates (#0F172A) for high-level navigation and primary actions to anchor the UI.
- **Layered Neutrals:** A range of cool grays (Slate 50 to Slate 400) creates structural hierarchy through subtle background shifts rather than heavy lines.
- **Subtle Gradients:** Primary buttons and active states should use linear gradients (e.g., Slate 800 to Slate 950) to create a soft, machined-metal luster.
- **Semantic Accents:** Success and Warning states use high-vibrancy emeralds and ambers, but are applied sparingly (dots, thin strokes, or soft glows) to maintain the sophisticated restraint of the system.

## Typography
The system utilizes **Plus Jakarta Sans** for its balanced, modern proportions and friendly yet professional character. To introduce an "engineered" feel, **Geist** is used for labels, data points, and technical metadata.

- **Tracking:** Headlines feature tighter tracking (-1% to -2%) to feel cohesive and "locked in."
- **Weight Distribution:** Use SemiBold (600) for hierarchy instead of Bold (700) where possible to maintain a refined, lighter aesthetic.
- **Rhythm:** Line heights are generous (1.5x - 1.6x) for body text to promote readability in long-form enterprise reporting.

## Layout & Spacing
The system adheres to a strict **8px Grid**, ensuring every element is mathematically aligned. 

- **Philosophy:** Emphasize horizontal breathing room. The layout uses a fixed-width container for content (1280px max) on desktop to prevent line lengths from becoming unreadable.
- **Desktop:** 12-column grid with 24px gutters. Large 64px side margins create a "framed" look.
- **Tablet:** 8-column grid with 24px gutters and 32px margins.
- **Mobile:** 4-column grid with 16px gutters and 16px margins. 
- **Vertical Rhythm:** Increase standard section padding to 'lg' (48px) or 'xl' (80px) to separate distinct functional areas, signaling a premium lack of clutter.

## Elevation & Depth
Depth is communicated through **Glassmorphism** and high-diffusion ambient shadows.

- **Surface Layers:** The base background is a soft neutral (Slate 50). The primary navigation and "Floating" cards utilize a backdrop-blur (20px to 40px) with a semi-transparent white fill (70-80% opacity).
- **Shadows:** Avoid harsh, dark shadows. Use a "Soft Elevated" shadow: `0px 12px 32px rgba(15, 23, 42, 0.08)`. This creates a sense of the UI floating weightlessly above the base.
- **Outlines:** Use ultra-thin (1px) borders in a slightly darker shade than the surface (e.g., Slate 200 at 50% opacity) to define edges without adding visual noise.

## Shapes
The shape language is controlled and intentional. 

- **Standard Radius:** 8px (0.5rem) for smaller components like inputs and buttons.
- **Large Radius:** 16px (1rem) for cards, modals, and container surfaces. 
- **Interactive Elements:** Maintain consistent corner radii across grouped elements to reinforce the "grid" feel. Avoid pill shapes unless used for status indicators (chips).

## Components
- **Data Tables:** These are the centerpiece. Use generous cell padding (16px vertical, 24px horizontal). Headers should use the **Geist** label style. Row hover states should use a very subtle Slate 50 background with a 1px Primary accent on the far left.
- **Buttons:** Apply a subtle top-to-bottom gradient. Primary buttons should have a 1px inner highlight on the top edge to simulate a "beveled" premium feel.
- **Cards:** Incorporate the 16px border radius with a subtle 1px border. Backgrounds should be glassmorphic when placed over colored or textured areas.
- **Input Fields:** Use a 1px Slate 200 border that transitions to Slate 900 on focus. The background should be a solid Slate 50 to differentiate from the primary white/glass surface.
- **Chips/Badges:** Use a "soft tint" approach—light background fills (10% opacity) with high-contrast text in the same hue.