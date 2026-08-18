export const THERMAL_80MM = `@page { size: 80mm auto; margin: 0; } body { margin: 0; }`;
export const THERMAL_58MM = `@page { size: 58mm auto; margin: 0; } body { margin: 0; }`;
export const thermalWidthMm = (w: 80 | 58) => (w === 58 ? '58mm' : '80mm');
