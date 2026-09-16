# Project Instructions

## Overview

This project is a component-based Design System built with React and designed to integrate with Figma.

The project uses:

- React
- Storybook
- Style Dictionary
- Turborepo
- Figma
- Figma MCP

The goal is to maintain a consistent connection between design, design tokens, components, documentation, and implementation.

---

# Documentation References

Use the following official documentation as the primary source of truth when working with the technologies in this project.

## React

Official React documentation:

https://react.dev/learn

Use this documentation for:

- React components
- Props
- State
- Hooks
- Component composition
- React patterns
- React APIs

Prefer current React documentation and practices over outdated patterns.

---

## Storybook

Official Storybook documentation:

https://storybook.js.org/docs

Use this documentation for:

- Component stories
- Storybook configuration
- Component documentation
- Controls
- Args
- Testing
- Accessibility
- Visual testing
- Storybook addons
- Storybook integrations

When creating or modifying Storybook stories, follow the current Storybook documentation.

---

## Style Dictionary

Official Style Dictionary documentation:

https://styledictionary.com/getting-started/installation/

Use this documentation for:

- Design tokens
- Token transformations
- Token references
- Token builds
- CSS variables
- Token formats
- Platform-specific outputs
- Style Dictionary configuration

Design tokens should be treated as a central part of the Design System.

Do not hardcode values when an appropriate design token already exists.

---

## Turborepo Design System

Official Vercel example:

https://vercel.com/templates/react/turborepo-design-system

Use this as a reference for:

- Turborepo project structure
- Monorepo organization
- React component libraries
- Shared packages
- Design System architecture
- Storybook integration
- Package organization
- Build configuration

Do not blindly copy the example. Adapt its architecture to the existing project.

---

## Figma MCP

Official Figma documentation:

https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server

Use this documentation when working with:

- Figma MCP
- Figma files
- Figma designs
- Design-to-code workflows
- Figma context
- Design implementation
- Connecting Figma with development workflows

When information from Figma is available through MCP, prefer using the actual Figma design context instead of guessing design specifications.

---

# General Development Rules

## Source of Truth

When implementing the Design System, consider the following sources in this order:

1. Existing project implementation
2. Existing design tokens
3. Figma design
4. Official documentation listed in this file
5. General conventions

Do not invent project conventions when an existing convention can be identified.

---

## Design Tokens

Design tokens should be reused whenever possible.

Before creating a new token:

1. Search the existing token structure.
2. Check whether an equivalent token already exists.
3. Follow the existing naming convention.
4. Only create a new token when necessary.

Avoid hardcoded:

- Colors
- Spacing
- Border radius
- Typography values
- Shadows
- Breakpoints
- Other design-system values

when an equivalent token exists.

---

## Components

Components should be:

- Reusable
- Composable
- Consistent
- Accessible
- Documented
- Compatible with the Design System

Avoid creating duplicate components when an existing component can be extended or composed.

Before creating a new component, inspect the existing component library.

---

## Storybook

Components should have appropriate Storybook stories.

Stories should represent meaningful component states and variants.

When adding a component, consider documenting:

- Default state
- Variants
- Sizes
- States
- Interactive behavior
- Edge cases
- Accessibility considerations

---

## Code Quality

Before modifying code:

1. Inspect the existing implementation.
2. Understand the project's architecture.
3. Check existing components and tokens.
4. Follow established naming conventions.
5. Make the smallest reasonable change.

Do not introduce a new library, abstraction, pattern, or architecture without a clear reason.

---

# Working With Documentation

When implementing something related to one of the technologies above:

1. Identify which documentation is relevant.
2. Consult the official documentation when necessary.
3. Prefer current APIs and recommended practices.
4. Do not rely on deprecated APIs when a current alternative exists.
5. Do not invent undocumented behavior.
6. If documentation conflicts with the existing project implementation, inspect the project before making changes.

---

# Before Making Changes

Always inspect the relevant files and understand the existing implementation before modifying the project.

For Design System changes, inspect:

- Tokens
- Components
- Storybook stories
- Package structure
- Build configuration
- Figma context when available

Avoid unnecessary refactoring.

---

# Important

The documentation links above are references, not instructions to reproduce their examples verbatim.

The existing project architecture and conventions take precedence over example implementations.

When uncertain about an API or implementation detail, consult the relevant official documentation rather than guessing.