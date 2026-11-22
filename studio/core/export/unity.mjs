// Unity: per page a metadata file (`<page>.sprites.json`: rectangles in Unity's bottom-left coordinates, normalised pivots, clips with
// durations) and one small editor script (`AtlasImporter.cs`) that slices the page PNG from that file when it is imported.
// Written, not compiled and not opened in Unity.
import { json, clipName } from './common.mjs';

export const id = 'unity';
export const label = {en: 'Unity (sprite sheet + importer)', vi: 'Unity (sprite sheet + importer)'};

const importer = `// Editor script written by the studio export. Put it in any "Editor" folder of the Unity project.
// When a PNG with a "<name>.sprites.json" beside it is imported, this slices it into sprites with the rectangles and pivots in that file.
using System;
using System.IO;
using UnityEditor;
using UnityEngine;

[Serializable] class StudioRect { public int x, y, w, h; }
[Serializable] class StudioPivot { public float x, y; }
[Serializable] class StudioSprite { public string name; public StudioRect rect; public StudioPivot pivot; }
[Serializable] class StudioSheet { public int pixelsPerUnit; public StudioSprite[] sprites; }

public class AtlasImporter : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        string sidecar = Path.ChangeExtension(assetPath, null) + ".sprites.json";
        if (!File.Exists(sidecar)) return;
        var sheet = JsonUtility.FromJson<StudioSheet>(File.ReadAllText(sidecar));
        var importer = (TextureImporter)assetImporter;
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = sheet.pixelsPerUnit;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        var metas = new SpriteMetaData[sheet.sprites.Length];
        for (int i = 0; i < metas.Length; i++)
        {
            var s = sheet.sprites[i];
            metas[i] = new SpriteMetaData { name = s.name, rect = new Rect(s.rect.x, s.rect.y, s.rect.w, s.rect.h), alignment = (int)SpriteAlignment.Custom, pivot = new Vector2(s.pivot.x, s.pivot.y) };
        }
        importer.spritesheet = metas;
    }
}
`;

export async function build(desc, {pixelsPerUnit = 16} = {}) {
  const files = [], copies = desc.pages.map(p => ({page: p.index, name: `unity/${p.image}`}));
  for (const p of desc.pages) {
    const mine = desc.frames.filter(f => f.page === p.index), keys = new Set(mine.map(f => f.key));
    const sprites = mine.map(f => ({name: f.key, rect: {x: f.x, y: p.height - f.y - f.h, w: f.w, h: f.h},
      pivot: f.pivotPx ? {x: f.pivotPx[0] / f.w, y: 1 - f.pivotPx[1] / f.h} : {x: 0.5, y: 0.5}, hasPivot: Boolean(f.pivotPx)}));
    const clips = desc.clips.map(c => ({name: `${c.asset}/${clipName(c)}`, loop: c.loop, frames: c.frames.filter(k => keys.has(k)).map(k => ({sprite: k, durationMs: mine.find(f => f.key === k).durationMs}))}))
      .filter(c => c.frames.length);
    files.push({name: `unity/${p.name}.sprites.json`, data: json({schema: 'studio.unity-sprites', version: 1, texture: p.image, size: {w: p.width, h: p.height}, pixelsPerUnit,
      coordinates: 'rect.y is measured from the BOTTOM edge of the texture and pivot.y from the bottom of the sprite, as Unity expects', sprites, clips})});
  }
  files.push({name: 'unity/Editor/AtlasImporter.cs', data: Buffer.from(importer)});
  return {files, copies, notes: [
    'To use it: copy the page PNG and its .sprites.json into Assets/ (same folder, same base name, e.g. atlas-0.png and atlas-0.sprites.json) and AtlasImporter.cs into an Assets/**/Editor folder; Unity slices the sheet when it imports the PNG (reimport it if the JSON came second).',
    'What you still do in Unity: the importer only slices sprites. It does not create AnimationClips, Animators or prefabs; the "clips" in the JSON list sprite order and durations for you or your own script to build them from.',
    'Pivots are normalised with Y up; a frame with no recorded pivot gets the centre.',
    'Written, not compiled and not opened in Unity: the script uses the long-standing TextureImporter.spritesheet API, which newer Unity versions mark obsolete in favour of the Sprite Editor data provider.']};
}
