# DreamVision

Interactive real-time 2D fluid dynamics simulation in the browser, based on
Jos Stam's ["Real-Time Fluid Dynamics for Games"](https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/GDC03.pdf)
(a Navier-Stokes solver), rendered on an HTML canvas.

Built with [Next.js](https://nextjs.org/) (App Router) + [Tailwind CSS](https://tailwindcss.com/),
deployed to [Cloudflare Workers](https://workers.cloudflare.com/) via
[OpenNext](https://opennext.js.org/cloudflare).

## Getting Started

Requirements: Node.js and pnpm (versions are pinned in `mise.toml` — run
`mise install` if you use [mise](https://mise.jdx.dev/)).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and click / touch-drag on
the canvas to add fluid.

## Scripts

| Script       | What it does                                       |
| ------------ | -------------------------------------------------- |
| `pnpm dev`   | Start the development server                       |
| `pnpm build` | Production build                                   |
| `pnpm lint`  | ESLint + type-check + Prettier check (in parallel) |
| `pnpm fix`   | Auto-fix ESLint and Prettier issues                |
| `pnpm test`  | Run unit tests (Vitest)                            |

## Project Layout

- `src/lib/fluid-simulation.ts` — the fluid solver (pure TypeScript, no DOM);
  unit-tested in `src/lib/fluid-simulation.test.ts`
- `src/components/FluidCanvas.tsx` — canvas rendering, pointer interaction,
  and simulation controls
- `src/app/` — Next.js App Router pages

## Deployment

Pushes to `main` deploy to Cloudflare Workers via the `Deploy` GitHub Actions
workflow (OpenNext build + `opennextjs-cloudflare deploy`). Pull requests get
a preview upload with the version preview URL posted as a sticky PR comment.
