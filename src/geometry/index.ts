// Entry point for 3D models: picks the right builder for each product.

import type { Product } from '../codes/types';
import { buildDamper, buildSilencer } from './accessories';
import { buildBend } from './bend';
import { buildDuct, type DuctModel } from './duct';
import type { Materials } from './materials';
import { buildRoundTransition } from './roundTransition';
import { buildSBend } from './sbend';
import { buildTee } from './tee';
import { buildTransition } from './transition';
import { buildUnit } from './unit';

export function buildModel(p: Product, mat: Materials): DuctModel {
  switch (p.kind) {
    case 'KK': return buildDuct(p, mat);
    case 'KD': return buildTransition(p, mat);
    case 'KB': return buildBend(p, mat);
    case 'KS': return buildSBend(p, mat);
    case 'KÖ': return buildRoundTransition(p, mat);
    case 'KT': return buildTee(p, mat);
    case 'AGG': return buildUnit(p, mat);
    case 'LD': return buildSilencer(p, mat);
    case 'SP': return buildDamper(p, mat);
  }
}
