// Rounds a number to 2 decimal places, guarding against binary floating-point
// drift (e.g. 2.9970000000000003) so document totals sent to the API and
// shown on screen always agree to the cent. Never Math.floor/round a monetary
// total to an integer -- the backend persists 2dp values and the FE must send
// and display the same shape it will be saved as.
export const round2 = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
};
