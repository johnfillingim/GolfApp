/**
 * The scoring package: a direct port of `Packages/Scoring` from the Swift app.
 *
 * Like the original it depends on nothing but the language itself — no DOM, no
 * storage, no React. All money math lives here and nowhere else, and the whole
 * layer is covered by the worked-example tests in `__tests__`, ported from the
 * Swift XCTest suite.
 */

export * from './types';
export * from './money';
export * from './handicapping';
export * from './snapshot';
export * from './evaluation';
export * from './matchEngine';
export * from './nassauEngine';
export * from './skinsEngine';
export * from './matchPlayEngine';
export * from './wolfEngine';
export * from './strokePlayEngine';
export * from './evaluator';
export * from './settlement';
export * from './roundMerge';
export * from './milestones';
export * from './narrative';
export * from './pointsSupport';
export * from './betSummary';
export { sideName, shortName } from './engineSupport';
