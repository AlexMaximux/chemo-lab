import { SPECIES } from './data/species';
import { Mixture } from './mixture';

const KW_298 = 1.0e-14;

function hydroxideStoichiometry(id: string, formula: string): number {
  if (id === 'Ca(OH)2' || id === 'Ba(OH)2' || id === 'Mg(OH)2' || formula.includes('(OH)2')) {
    return 2;
  }
  return 1;
}

export function solveHydrogenConcentration(m: Mixture): number {
  const volumeL = m.volumeL > 0 ? m.volumeL : 1.0;

  const acids: Array<{ conc: number; ka: number; ka2?: number }> = [];
  const bases: Array<{ conc: number; kb: number; equiv: number }> = [];

  for (const [id, n] of Object.entries(m.moles)) {
    if (n <= 0) continue;
    const sp = SPECIES[id];
    if (!sp) continue;

    // Only dissolved aqueous or soluble acid/base species contribute to solution [H+]
    const conc = n / volumeL;
    if (sp.ka !== undefined && sp.ka > 0) {
      acids.push({
        conc,
        ka: sp.ka,
        ka2: id === 'H2SO4' ? 1.2e-2 : undefined,
      });
    }
    if (sp.kb !== undefined && sp.kb > 0) {
      bases.push({
        conc,
        kb: sp.kb,
        equiv: hydroxideStoichiometry(id, sp.formula),
      });
    }
  }

  if (acids.length === 0 && bases.length === 0) {
    return 1.0e-7;
  }

  // Charge balance function f([H+]) = [H+] + sum(cations) - [OH-] - sum(anions) = 0
  // Strictly monotonically increasing in [H+] over (0, +infinity).
  const chargeBalance = (h: number): number => {
    const oh = KW_298 / h;
    let net = h - oh;

    for (const b of bases) {
      const frac = b.kb / (oh + b.kb);
      net += b.equiv * b.conc * frac;
    }

    for (const a of acids) {
      if (a.ka2 !== undefined) {
        const denom = h * h + a.ka * h + a.ka * a.ka2;
        const alpha1 = (a.ka * h) / denom;
        const alpha2 = (a.ka * a.ka2) / denom;
        net -= a.conc * (alpha1 + 2 * alpha2);
      } else {
        const frac = a.ka / (h + a.ka);
        net -= a.conc * frac;
      }
    }

    return net;
  };

  // Bisection on log10([H+]) in [-16, 2] (corresponding to pH in [-2, 16])
  let lowLogH = -16.0;
  let highLogH = 2.0;

  for (let iter = 0; iter < 100; iter++) {
    const midLogH = 0.5 * (lowLogH + highLogH);
    const h = Math.pow(10, midLogH);
    const val = chargeBalance(h);
    if (val < 0) {
      lowLogH = midLogH;
    } else {
      highLogH = midLogH;
    }
  }

  return Math.pow(10, 0.5 * (lowLogH + highLogH));
}

export function pH(m: Mixture): number {
  const h = solveHydrogenConcentration(m);
  const rawPh = -Math.log10(h);
  return Math.max(-2, Math.min(16, rawPh));
}
