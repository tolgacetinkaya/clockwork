# Piko front-view animation atlas provenance

Created 2026-10-29 with built-in imagegen using the existing original puffin.png as the character/material reference. Original generated PNG: exec-ab23d222-3a11-4d0e-8468-f79980c573e4.png. No Python editing or external asset pack was used.

Actual dimensions: 1122 by 1402 pixels. Grid: 4 columns by 5 rows, normalized cell dimensions approximately 280.5 by 280.4 pixels. Transparent PNG. Twenty front-view poses retain charcoal origami body, cream face, orange beak/feet, purple flippers and gold wind-up key.

Row order: idle (neutral, half blink, blink, tilt); walk (alternate feet); work (look down and alternate flipper taps); attention (wave); success (crouch, hop, raised wings, happy landing).

Generation prompt: Create a production sprite atlas, exactly four columns and five rows, twenty uniformly aligned full-body puffin poses on actual transparency. Turn the reference Piko to full front view with consistent proportions, both eyes visible and beak centered. Keep complete characters within cells and safe transparent margins. No labels, numbers, grid lines, scenery, platforms or shadows. Include real articulated changes to legs, flippers and expression, not translated copies. Requested 1024 by 1280; tool returned 1122 by 1402.

Visual inspection: twenty complete characters appear in the requested 4 by 5 layout, with visible pose/expression variation. No bodies cross adjacent cells. Approximate cell alignment and scale vary slightly as expected for generated raster poses; runtime animation should be reviewed at its displayed size. Some work/wave poses contain small drawn motion marks within their cells. Margins are tighter than requested on the first row and in raised-wing success poses.
A built-in imagegen cleanup edit (exec-58ef7942-fedc-4cd4-86ff-c9a2cf076354.png) is the final asset. It preserves1122x1402 and4x5poses, removes motion marks and reduces high-alpha red outliers from121pixels to7. Most remaining red-edge RGB values have alpha at or below16/255 and must be judged in the composited runtime rather than a raw RGB preview. No deterministic pixel editing was applied.
