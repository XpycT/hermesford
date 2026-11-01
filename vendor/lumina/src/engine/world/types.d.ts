// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for src/engine/world: fields created lazily (`this._x ??= …`) or by another
// module, which the class body cannot declare without a runtime change. Also: two catalog ↔
// PropFactory assertions, checked at type level only (end of file).
import './TileMap.js';
import type { OBJECT_TYPES } from '../level/ObjectCatalog.js';
import type { PropFactory } from './Props.js';

declare module './TileMap.js' {
  interface TileMap {
    /** `_tint`'s fbm2 options of the warm/cool noise, made on first use (it runs per vertex). */
    _tintOptsA?: { octaves: number; seed: number };
    /** `_tint`'s fbm2 options of the brightness noise, made on first use. */
    _tintOptsB?: { octaves: number; seed: number };
  }
}

// ---- catalog ↔ PropFactory (checked at type level only) ----------------------------------------

type Catalog = typeof OBJECT_TYPES;
type AssertNever<T extends never> = T;
/** The catalog types of kind 'prop'. */
type PropKindType = { [T in keyof Catalog]: Catalog[T]['kind'] extends 'prop' ? T : never }[keyof Catalog];
/**
 * ObjectBuilder.build calls `factory[obj.type]` for the prop types it does not build inline (light,
 * waterfall): each needs a PropFactory method of its name (a catalog type without one builds
 * nothing — PROP-10).
 */
type _PropTypesHaveFactoryMethods = AssertNever<Exclude<PropKindType, keyof PropFactory | 'light' | 'waterfall'>>;
/** The options parameter of the PropFactory method of prop type T (the line types fence / bridge / garland: the 6th). */
type FactoryOpts<T extends keyof PropFactory> =
  PropFactory[T] extends (...a: infer A) => any ? NonNullable<A[T extends 'fence' | 'bridge' | 'garland' ? 5 : 3]> : never;
type DefaultOptsKey<T extends keyof Catalog> = Catalog[T]['defaults'] extends { opts: infer O } ? keyof O : never;
/**
 * Catalog `defaults.opts` keys the type's PropFactory method does not declare (methods whose
 * options are untyped are skipped).
 */
type UnknownDefaultOpts = {
  [T in PropKindType & keyof PropFactory]: [keyof FactoryOpts<T>] extends [never] ? never
    : Exclude<DefaultOptsKey<T>, keyof FactoryOpts<T>>;
}[PropKindType & keyof PropFactory];
type _CatalogOptsKnownToTheFactory = AssertNever<UnknownDefaultOpts>;
