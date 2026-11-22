// The engine exports, one module per format. Each exports {id, label, build(desc, options)}; see common.mjs for the contract.
import * as phaser from './phaser.mjs';
import * as pixi from './pixi.mjs';
import * as godot from './godot.mjs';
import * as unity from './unity.mjs';
import * as aseprite from './aseprite.mjs';
import * as tiled from './tiled.mjs';

export const formats = [phaser, pixi, godot, unity, aseprite, tiled];
export const formatOf = id => formats.find(f => f.id === id);
export { describeAtlas, keyIndex } from './describe.mjs';
