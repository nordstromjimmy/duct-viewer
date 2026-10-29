// Entry point for 3D models: picks the right builder for each product.

import type { Product } from '../codes/types';
import { buildBend } from './bend';
import { buildDuct, type DuctModel } from './duct';
import type { Materials } from './materials';
import { buildTransition } from './transition';
import { buildSBend } from './sbend';

export function buildModel(p: Product, mat: Materials): DuctModel {
  switch (p.kind) {
    case 'KK': return buildDuct(p, mat);
    case 'KD': return buildTransition(p, mat);
    case 'KB': return buildBend(p, mat);
    case 'KS': return buildSBend(p, mat);
  }
}