"""Exercise two real catalog entries in an isolated, regenerable asset tree."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import promote_frame as promote
import pack_atlases as pack

UI = "ui/ui_minimap/room_none_0"
VFX = "vfx/hit_spark_0"


class PromotionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve() / "project"
        self.library = self.root.parent / "library"
        self.root.mkdir()
        for name in ["assets/manifest.json", "tools/generators/palette.json",
                     "tools/generators/vfx_specs/hit_spark.json", "assets/processed/vfx/hit_spark.json"]:
            self.copy(name)
        for file in (pack.ROOT / "assets/processed/vfx").glob("hit_spark_*.png"):
            if not file.stem.endswith("_sheet"):
                self.copy(file.relative_to(pack.ROOT))
        for directory in ["assets/processed/ui/ui_minimap", "assets/raw/environment_items/ui/ui_minimap"]:
            shutil.copytree(pack.ROOT / directory, self.root / directory)
        index = "assets/processed/vfx/vfx_index.json"
        data = pack.read_json(pack.ROOT / index)
        data["effects"] = [e for e in data["effects"] if e["id"] == "hit_spark"]
        pack.write_json(self.root / index, data)
        self.build(self.root / "assets/atlases")

    def copy(self, name):
        destination = self.root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pack.ROOT / name, destination)

    def build(self, output):
        subprocess.run([sys.executable, str(pack.ROOT / "tools/scripts/pack_atlases.py"),
                        "--source", str(self.root / "assets/processed"), "--manifest", str(self.root / "assets/manifest.json"),
                        "--output", str(output)], check=True, capture_output=True)

    def inspector(self, key, mode):
        script = """
          import {loadCatalog} from 'CATALOG';
          import {revisionStore} from 'STORE';
          import {encodePixels} from 'PNG';
          const [root,dir,key,mode]=process.argv.slice(1);
          const c=await loadCatalog(root), f=c.frames.get(key), png=await c.baseline(f);
          const store=revisionStore(root,dir);
          const get=(action,args)=>store.operate(f,png,action,args);
          let snap=get('frame',{});
          if(mode==='edit'){
            const {width,height}=f.info;
            snap=get('save',{baseRevision:snap.head,png:encodePixels(width,height,Buffer.alloc(width*height*4)),
              metadata:key.startsWith('ui/')?{pivot:[1,2]}:{pivot:[2,1],durationMs:81}});
          } else if(mode==='approve') snap=get('review',{revision:snap.head,status:'approved',text:'private comment'});
          console.log(JSON.stringify(snap));store.close();
        """
        for label, name in (("CATALOG", "editor-catalog"), ("STORE", "editor-store"), ("PNG", "editor-png")):
            script = script.replace(label, (pack.ROOT / f"studio/server/{name}.mjs").as_uri())
        library = self.library if mode != "fresh" else self.root.parent / "fresh"
        result = subprocess.run(["node", "--input-type=module", "-e", script, str(self.root), str(library), key, mode],
                                capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def run_promotion(self, key, apply=False):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            promote.promote(self.root, self.library, key, 1, apply)
        return output.getvalue()

    def test_promotion_and_rebuild(self):
        atlas = self.root / "assets/atlases"
        for key in (UI, VFX):
            self.assertEqual(self.inspector(key, "edit")["status"], "pending")
            with self.assertRaisesRegex(ValueError, "requires approval"):
                self.run_promotion(key)
            self.inspector(key, "approve")
            with self.assertRaisesRegex(ValueError, "Stale"):
                promote.promote(self.root, self.library, key, 0, False)
            previous = promote.content(self.root / promote.OVERLAY)
            preview = self.run_promotion(key)
            self.assertIn(promote.OVERLAY, preview)
            self.assertEqual(promote.content(self.root / promote.OVERLAY), previous)
            self.assertEqual(self.run_promotion(key, True), preview)
            self.assertIn("already published", self.run_promotion(key, True))
            local = self.inspector(key, "view")
            fresh = self.inspector(key, "fresh")
            self.assertEqual((fresh["revision"], fresh["status"]), (0, "approved"))
            self.assertEqual(fresh["pngBase64"], local["pngBase64"])
            self.assertEqual(fresh["metadata"], local["metadata"])
            self.assertEqual((local["revision"],local["status"]), (1,"approved"))
            self.assertEqual(len(local["comments"]),1)
            for profile in pack.PROFILES:
                frames = pack.read_json(atlas / profile / "atlas-0.json")["frames"]
                size = frames[key]["sourceSize"]
                pivot = fresh["metadata"]["pivot"]
                self.assertEqual(frames[key]["pivot"], {"x":pivot[0]/size["w"],"y":pivot[1]/size["h"]})
                self.assertNotIn("pivot", frames["vfx/hit_spark_1"])
                if key == VFX:
                    self.assertEqual(frames[key]["duration"],81)
            self.assertNotIn(b"private comment", (self.root / promote.OVERLAY).read_bytes())
        rebuilt = self.root.parent / "rebuilt"
        self.build(rebuilt)
        for file in rebuilt.rglob("*"):
            if file.is_file():
                self.assertEqual(file.read_bytes(), (atlas / file.relative_to(rebuilt)).read_bytes())
        spec = self.root / "tools/generators/vfx_specs/hit_spark.json"
        pack.write_json(spec, {"changed":True})
        with self.assertRaisesRegex(ValueError,"stale"):
            self.run_promotion(VFX)

    def test_failure_and_crash_recovery(self):
        self.inspector(UI,"edit")
        self.inspector(UI,"approve")
        original = promote.replace
        calls = []
        def interrupt(file, data):
            calls.append(file)
            if len(calls)==2:
                raise OSError("test interruption")
            original(file,data)
        with patch.object(promote,"replace",interrupt), self.assertRaisesRegex(OSError,"test interruption"):
            self.run_promotion(UI,True)
        self.assertFalse((self.root / promote.OVERLAY).exists())
        # Simulate a killed process after the first journalled replacement.
        with contextlib.closing(promote.journal(self.root)) as db:
            db.execute("INSERT INTO changes VALUES(?,NULL,?)",(promote.OVERLAY,b"partial"))
        (self.root / promote.OVERLAY).write_bytes(b"partial")
        promote.rollback(self.root)
        self.assertFalse((self.root / promote.OVERLAY).exists())
        self.run_promotion(UI,True)


if __name__ == "__main__":
    unittest.main()
