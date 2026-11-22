// While the director panel swaps {{char}}/{{user}} for a while (a side scene with other names), Meatball steps out:
// no note is added, and the replies made during it are not recorded. When the swap ends, everything goes on as before.
const D = () => (window.MeatballDirector?.v === 1 ? window.MeatballDirector : null);
export const swapOn = () => { try { return (D()?.swaps?.() || []).length > 0; } catch (e) { return false; } };
