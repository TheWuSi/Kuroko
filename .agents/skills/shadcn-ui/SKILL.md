---
name: shadcn-ui
description: >-
  Use this skill when installing, configuring, or developing UI components with shadcn/ui in Vite, React, and Tailwind CSS projects. Covers CLI initialization, component addition, theme configuration, path aliases, and responsive layout integration.
---

# shadcn/ui for Vite & React

This skill provides step-by-step procedures, CLI commands, and architectural conventions for setting up and working with **shadcn/ui** in Vite-based React applications.

Detailed official setup instructions are available in [Vite Installation Reference](./references/vite-installation.md).

---

## 1. Quick Workflow & Commands

In a Vite project with `pnpm` (or `npm`/`bun`):

### Check / Initialize shadcn
```bash
# In the frontend directory (where package.json and vite.config.ts reside)
pnpm dlx shadcn@latest init
# or non-interactive with defaults
pnpm dlx shadcn@latest init -y
```

### Adding Components
```bash
# Add a single component (e.g. button)
pnpm dlx shadcn@latest add button

# Add multiple common UI components at once
pnpm dlx shadcn@latest add card dialog sheet table badge input textarea progress dropdown-menu tooltip

# Overwrite existing component file if updating
pnpm dlx shadcn@latest add button --overwrite
```

---

## 2. Project Prerequisites & Configuration

For shadcn/ui to function seamlessly in Vite, ensure the following configurations are present:

### 1. Tailwind CSS v4 / `@tailwindcss/vite`
- In `vite.config.ts`:
  ```ts
  import tailwindcss from '@tailwindcss/vite'
  export default defineConfig({
    plugins: [react(), tailwindcss()],
  })
  ```
- In `src/styles/globals.css` (or `src/index.css`):
  ```css
  @import "tailwindcss";
  ```

### 2. Path Aliases (`@/*`)
- In `tsconfig.json` & `tsconfig.app.json`:
  ```json
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
  ```
- In `vite.config.ts`:
  ```ts
  import path from 'path'
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  }
  ```

### 3. Utility Function (`cn`)
Located at `@/lib/utils` (`src/lib/utils.ts`):
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 4. `components.json`
Configuration file located at project root (e.g., `frontend/components.json`):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

---

## 3. UI Guidelines & Best Practices

1. **Direct Code Ownership**: shadcn/ui components live directly inside your project (`src/components/ui/`). Modify them freely to fit project requirements rather than wrapping them with extra layers.
2. **Mobile-First & Touch Target**: Ensure all interactive elements (buttons, inputs, menu triggers) have a minimum touch target of `44px` (`min-h-[44px]`) on mobile viewports.
3. **Table-to-Card Responsive Pattern**: On mobile viewports (`< 768px`), never allow tabular data to overflow horizontally with broken tables. Use conditional rendering or CSS to transition desktop tables into mobile card lists.
4. **Color Tokens & Semantic Classes**: Always use semantic theme classes (`bg-card`, `text-card-foreground`, `text-muted-foreground`, `border-border`) so components naturally adapt between light and dark modes.
5. **Monospace Fields**: For technical identifiers such as hashes, hashes, codes, capacities, and file paths, use `font-mono` (`JetBrains Mono`).

---

## 4. Troubleshooting & Verification

- **Module Not Found `@/components/ui/...`**: Verify `tsconfig.json` and `tsconfig.app.json` both have `"paths": { "@/*": ["./src/*"] }`.
- **Styling Missing / Unstyled Components**: Verify `src/styles/globals.css` is imported in `src/main.tsx` and that `@import "tailwindcss";` is present.
- **Dependency Conflicts**: shadcn uses Radix UI primitives (`@radix-ui/react-*`). Install required dependencies with `pnpm add @radix-ui/react-<primitive>`.
- **Validation**:
  ```bash
  pnpm run lint
  pnpm run build
  ```

