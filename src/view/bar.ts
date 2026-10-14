/**
 * Stacked bar allocation. Given category sizes and the window size, returns the
 * number of cells for each category plus one trailing "free" slot, so that the
 * cells always add up to exactly `width` (largest remainder method). Every
 * category with a value > 0 gets at least one cell when there is room for it.
 */
export function allocate(values: number[], window: number, width: number): number[] {
	const w = Math.max(0, Math.floor(width));
	const vals = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
	const used = vals.reduce((a, v) => a + v, 0);
	const free = Math.max(0, (Number.isFinite(window) ? window : 0) - used);
	const items = [...vals, free];
	const denom = items.reduce((a, v) => a + v, 0);
	if (w === 0) return items.map(() => 0);
	if (denom <= 0) return items.map((_, i) => (i === items.length - 1 ? w : 0));

	const raw = items.map((v) => (v / denom) * w);
	const cells = raw.map(Math.floor);
	let rest = w - cells.reduce((a, c) => a + c, 0);
	const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (let k = 0; rest > 0 && k < order.length; k++, rest--) cells[order[k].i]++;

	// minimum one cell for every non-empty category (not for "free")
	const nonEmpty = vals.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
	if (nonEmpty.length <= w) {
		for (const i of nonEmpty) {
			if (cells[i] > 0) continue;
			// take the cell from the biggest donor that can spare one
			let donor = -1;
			for (let j = 0; j < cells.length; j++) {
				const floor = j < vals.length && vals[j] > 0 ? 1 : 0;
				if (cells[j] > floor && (donor < 0 || cells[j] > cells[donor])) donor = j;
			}
			if (donor < 0) break;
			cells[donor]--;
			cells[i]++;
		}
	}
	return cells;
}
