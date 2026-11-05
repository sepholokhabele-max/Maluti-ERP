// Sesotho versions of the yellow help notes (HELP in help.js). Same contexts and field names; a note that is not
// translated yet falls back to English. Written for Lesotho (Lesotho orthography); a native speaker may refine wording.
import { A } from './help_st_a.js';
import { B } from './help_st_b.js';
import { C } from './help_st_c.js';
import { D } from './help_st_d.js';
import { E } from './help_st_e.js';
export const HELP_ST = {};
for (const part of [A, B, C, D, E]) for (const [ctx, notes] of Object.entries(part)) HELP_ST[ctx] = { ...(HELP_ST[ctx] || {}), ...notes };
