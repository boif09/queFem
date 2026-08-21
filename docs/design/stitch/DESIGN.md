---
> **Referència històrica:** aquest lliurable de Stitch correspon a una proposta visual anterior. No és la font de veritat del sistema Pop Editorial ni del branding vigent; per a canvis actuals cal inspeccionar `frontend/src/` i els assets implementats.

name: Modern Catalan Horizon
colors:
  surface: '#fbf9f0'
  surface-dim: '#dcdad2'
  surface-bright: '#fbf9f0'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f4eb'
  surface-container: '#f0eee5'
  surface-container-high: '#eae8df'
  surface-container-highest: '#e4e3da'
  on-surface: '#1b1c17'
  on-surface-variant: '#54433e'
  inverse-surface: '#30312b'
  inverse-on-surface: '#f3f1e8'
  outline: '#86736d'
  outline-variant: '#d9c1bb'
  surface-tint: '#904b35'
  primary: '#8d4933'
  on-primary: '#ffffff'
  primary-container: '#ab6049'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb59e'
  secondary: '#795900'
  on-secondary: '#ffffff'
  secondary-container: '#fece64'
  on-secondary-container: '#765600'
  tertiary: '#3b635c'
  on-tertiary: '#ffffff'
  tertiary-container: '#547c75'
  on-tertiary-container: '#f4fffb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd0'
  primary-fixed-dim: '#ffb59e'
  on-primary-fixed: '#3a0b00'
  on-primary-fixed-variant: '#733420'
  secondary-fixed: '#ffdea0'
  secondary-fixed-dim: '#efc058'
  on-secondary-fixed: '#261a00'
  on-secondary-fixed-variant: '#5c4300'
  tertiary-fixed: '#c0ebe2'
  tertiary-fixed-dim: '#a5cfc6'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#254e47'
  background: '#fbf9f0'
  on-background: '#1b1c17'
  surface-variant: '#e4e3da'
  slate-dark: '#1E293B'
  stone-muted: '#78716C'
  white: '#FFFFFF'
typography:
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Source Serif 4
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Source Serif 4
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
  max-width: 1280px
---

## Brand & Style

The design system is built to evoke the warmth of a Mediterranean afternoon and the organized clarity of a modern cultural hub. It serves as a digital town square for Catalonia, balancing communal warmth with professional utility.

The aesthetic follows a **Modern Minimalism** approach with **Tactile** accents. It prioritizes high-quality typography and a sophisticated color palette to ensure that the diverse range of events—from rural festivals to urban exhibitions—feels cohesive and curated. The style avoids "tech-coldness" by using organic colors and soft edges, creating an environment that feels as welcoming as a local plaça.

## Colors

The palette is rooted in the Catalan landscape. The **Primary Terracotta (#B86B53)** represents clay and earth, used for primary actions and brand emphasis. The **Secondary Ochre (#D4A742)** mirrors the Mediterranean sun and is used for highlights and specific category filtering. 

The **Deep Pine (#123C36)** provides a grounding contrast, ideal for footers, navigation headers, or high-level category iconography. The **Neutral Stone (#FDFBF2)** serves as the primary background color, providing a softer, more "paper-like" reading experience than pure white, which is reserved for card interiors and input fields to create subtle depth.

## Typography

This design system utilizes a sophisticated pairing of **Source Serif 4** for headlines and **Inter** for functional UI elements and body text. 

The serif typeface provides an editorial, trustworthy feel that nods to Catalan literary and news traditions. It is used for event titles and section headers to create a "cultural journal" aesthetic. **Inter** is employed for its exceptional legibility at small sizes, handling all data-heavy components like dates, locations, and filter controls. Scale typography aggressively on mobile to maintain a clear hierarchy; ensure that `display-lg` is only used on desktop landing sections.

## Layout & Spacing

The system uses a **Fluid Grid** with a 12-column structure for desktop and a 4-column structure for mobile. 

A strict 8px spacing scale governs all internal component dimensions. Content should be centered with a maximum width of 1280px to ensure readability on ultra-wide monitors. 

**Responsive Rules:**
- **Desktop:** 24px gutters, 64px side margins. Large Event Cards span 3 or 4 columns.
- **Tablet:** 16px gutters, 32px side margins. Grid reflows to 2 columns for event listings.
- **Mobile:** 16px side margins. Event Cards occupy the full width of the content area. Filter bars transition from horizontal rows to a vertically scrollable pill-list or a dedicated "Filter" modal.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows. 

The background uses the neutral Stone (#FDFBF2). Elevated elements like Event Cards and Search Bars use a pure White (#FFFFFF) fill with a very subtle 1px border (#E2E8F0) and a soft, diffused "ambient" shadow (0px 4px 20px, 4% opacity of the Primary color). This creates a "paper-on-table" effect that feels tactile and light. 

Interactive elements like buttons use a slight vertical lift (2px shadow) on hover to indicate "pressability."

## Shapes

The shape language is **Rounded**, using a 0.5rem (8px) base radius. This softens the interface, making it feel more approachable and modern. 

- **Cards & Containers:** Use 1rem (16px) for large containers to emphasize a friendly, modern containerized look.
- **Buttons & Tags:** Use a fully rounded "Pill" shape for category tags and primary buttons to distinguish them from structural content containers.
- **Inputs:** Use the base 8px radius to maintain a clean, architectural feel for functional tools.

## Components

### Search & Filter Patterns
The "Cercador" (Search) should be a prominent white bar with internal dividers. Use clear labels in Catalan: "Què vols fer?", "On?", and "Quan?". Filters should use horizontal scrolling "Pills" for categories (e.g., *Cultura*, *Gastronomia*, *Infantil*) that toggle between Stone and Ochre when active.

### Event Cards
Cards must prioritize the image with a 16:9 aspect ratio. Overlay the "Price" or "Free" (Gratuït) status in the top right corner using a high-contrast label. The title uses `headline-md` in Deep Pine, followed by a clear, icon-accompanied line for Date and Location in `label-md`.

### Detailed View
The detail page should feature a "Hero" layout. The description text must adhere to `body-lg` for maximum readability. Maps should be embedded in a container with a 16px border radius. "Source Attribution" should be placed at the bottom in `label-sm` with a light-grey font to remain unobtrusive but accessible.

### Buttons
Primary buttons use the Terracotta background with White text. Secondary buttons for "Add to Calendar" or "Share" should use a Transparent background with a Terracotta outline (Ghost style).
