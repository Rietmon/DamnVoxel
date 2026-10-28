# Benchmarks

How to check the budgets from [stack.md](stack.md#budgets) and what the latest measurements showed. The budgets are not repeated here — only the results.

## How to measure

| What | How |
|---|---|
| Chunk meshing in Node | `pnpm bench:mesher` — the median of 15 runs on typical and worst-case chunks, compared with the budget |
| A large scene | `/?bench=large`: the same measurement on a 1024 × 1024 terrain (16 times the area, far beyond MagicaVoxel's 256) |
| The viewport on a device | open `/?bench` in the device's browser: a 256³ scene (a 256 × 256 terrain up to 165 high), every chunk meshed on the main thread, then an 8-second camera orbit. The result shows in the panel at the top left and in the console |
| Bundle size | `pnpm build && pnpm size` |
| Idle frames | `?stats`: the “frames” counter does not grow while nothing happens |

An orbit in a headless browser (`node scripts/shot.ts`) runs on SwiftShader software rendering: its fps say nothing about a GPU, only the CPU numbers count.

## Results

### 2026-10-27 · PC (Windows 11, Node 24, Edge)

32³ chunk meshing (`pnpm bench:mesher`, median):

| Chunk | ms | quads |
|---|---|---|
| terrain surface | 0.47 | 1 735 |
| sphere | 0.47 | 3 498 |
| half a chunk, painted | 0.26 | 813 |
| random 30 % (near worst) | 3.0 | 41 123 |
| checkerboard (worst) | 3.8 | 98 304 |

The `?bench` scene in the browser: 269 chunks, chunk meshing median 0.30 ms, p95 0.80 ms; voxels in memory 2.0 MB, meshes on the GPU 8.2 MB; 173 thousand quads, 232 draw calls.

Conclusion: a typical chunk on a PC is 4 times faster than the phone budget, which leaves room for a phone that is usually 3–5 times slower. Worst-case chunks (noise, checkerboard) will not fit the phone budget, but they are rare in real models and go to workers without delaying the frame.

The large scene `?bench=large` (headless Edge with SwiftShader software graphics — the frame rate means nothing here, meshing and memory do): 4 269 chunks, chunk meshing median 0.30 ms, p95 0.50 ms, max 5 ms; voxels in memory 31.1 MB, JS heap 63 MB; 1.6 million quads, 1 966 draw calls; meshes on the GPU from 75 MB (measured while still loading).

Conclusion: there is no size limit — an object grows in 32³ chunks, chunk coordinates go to ±65 536 per axis (±2 million voxels), `.vox` is written in pieces of up to 256 (the “splits objects larger than 256” test). The bottleneck of a large scene is mesh memory on the GPU (~47 bytes per quad): on a phone, a 1024² scene is better kept in several objects with the unneeded ones hidden; the next step for such scenes is level of detail for distant chunks.

### Phone — not measured yet
Measurements on a mid-range phone are welcome: open `/?bench` on the phone and add the orbit fps, the frame p95 and the chunk meshing numbers here.
