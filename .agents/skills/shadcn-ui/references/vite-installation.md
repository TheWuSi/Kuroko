# Vite - shadcn/ui Installation Guide

> Source: https://ui.shadcn.com/docs/installation/vite.md
> Install and configure shadcn/ui for Vite.

## Table of Contents
- [Scaffold with shadcn/create](#scaffold-with-shadcncreate)
- [Scaffold with the CLI](#scaffold-with-the-cli)
- [Manual Configuration in an Existing Project](#manual-configuration-in-an-existing-project)
- [Adding Components](#adding-components)

---

## Scaffold with shadcn/create

1. Open [shadcn/create](https://ui.shadcn.com/create?template=vite) and build your preset visually. Choose your style, colors, fonts, icons, and more.
2. Click `Create Project`, choose your package manager, and copy the generated command:
   ```bash
   npx shadcn@latest init --preset [CODE] --template vite
   ```
3. Add components to your project:
   ```bash
   npx shadcn@latest add card
   ```

---

## Scaffold with the CLI

1. Run the `init` command to scaffold a new Vite project:
   ```bash
   npx shadcn@latest init -t vite
   ```
   For a monorepo project, use `--monorepo` flag:
   ```bash
   npx shadcn@latest init -t vite --monorepo
   ```
2. Add components:
   ```bash
   npx shadcn@latest add card
   ```

---

## Manual Configuration in an Existing Project

### 1. Create Project (if needed)
```bash
npm create vite@latest
# or: pnpm create vite
```
Select **React + TypeScript** template.

### 2. Add Tailwind CSS
```bash
npm install tailwindcss @tailwindcss/vite
# or: pnpm add tailwindcss @tailwindcss/vite
```

Replace `src/index.css` (or `src/styles/globals.css`) with:
```css
@import "tailwindcss";
```

### 3. Configure TypeScript Path Aliases

In `tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

In `tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 4. Update `vite.config.ts`

Install `@types/node` and configure path alias:
```bash
npm install -D @types/node
# or: pnpm add -D @types/node
```

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

### 5. Run the CLI to Initialize shadcn/ui

```bash
npx shadcn@latest init
# or: pnpm dlx shadcn@latest init
```

### 6. `components.json` Reference
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

## Adding Components

Add individual components using the CLI:
```bash
npx shadcn@latest add button
npx shadcn@latest add card dialog sheet table badge input textarea progress
# or with pnpm:
pnpm dlx shadcn@latest add button
```

Components are placed directly into `src/components/ui/` for full code ownership and customization.
