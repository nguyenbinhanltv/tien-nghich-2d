// Compatibility re-export: the raster primitives live in ../image.mjs now. The rig lane's own tests still import
// this path, so it stays; new code imports ../image.mjs.
export * from '../image.mjs';
