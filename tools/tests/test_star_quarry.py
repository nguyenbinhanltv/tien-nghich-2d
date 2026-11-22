"""Audit committed Star Quarry art, joins and atlas pixels independently of generation."""
import hashlib
import json
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSET = "lt_star_quarry"
RAW = ROOT/"assets/raw/longtime"/ASSET
NATIVE = ROOT/"assets/processed_longtime"/ASSET


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pixels(path):
    with Image.open(path) as image:
        return np.array(image)


def tile(clip,n):
    return pixels(NATIVE/f"{clip}_none_{n}.png")


class QuarryTests(unittest.TestCase):
    def test_source_frames(self):
        ledger=json.loads((RAW/"provenance.json").read_bytes())
        self.assertEqual(ledger["canonical_review_default"],"approved")
        self.assertEqual(ledger["pivot_px"],[0,0])
        self.assertEqual(ledger["source_sha256"],sha(RAW/"source.png"))
        source=pixels(RAW/"source.png")
        expected=[f"longtime/{ASSET}/{clip}_none_{n}" for clip,count in
                  (("floor",4),("edge",16),("wall_cap",4)) for n in range(count)]
        self.assertEqual([row["key"] for row in ledger["frames"]],expected)
        for row in ledger["frames"]:
            file=ROOT/row["path"]
            self.assertEqual(sha(file),row["sha256"])
            self.assertEqual(row["duration_ms"],0)
            x,y=row["source_xy"]
            native=pixels(file)
            self.assertEqual(native.shape,(16,16,4))
            self.assertTrue((native[:,:,3]==255).all())
            np.testing.assert_array_equal(source[y:y+16,x:x+16],native)

    def test_joins_and_masks(self):
        floors=[tile("floor",n) for n in range(4)]
        edges=[tile("edge",n) for n in range(16)]
        np.testing.assert_array_equal(edges[0],floors[0])
        self.assertEqual(len({a.tobytes() for a in floors}),4)
        self.assertEqual(len({a.tobytes() for a in edges}),16)
        for left in floors:
            for right in floors:
                np.testing.assert_array_equal(left[:,-1],right[:,0])
                np.testing.assert_array_equal(left[-1],right[0])
        for mask,a in enumerate(edges):
            for side,(x,y) in enumerate(((8,0),(15,8),(8,15),(0,8))):
                self.assertEqual(not np.array_equal(a[y,x],floors[0][y,x]),bool(mask & (1<<side)))
            for neighbor,b in enumerate(edges):
                # Adjacent tiles with no interior ledge and matching exterior arms.
                if not (mask & 2 or neighbor & 8) and (mask & 5)==(neighbor & 5):
                    np.testing.assert_array_equal(a[:,-1],b[:,0])
                if not (mask & 4 or neighbor & 1) and (mask & 10)==(neighbor & 10):
                    np.testing.assert_array_equal(a[-1],b[0])
        for side in range(4):
            wall=tile("wall_cap",side)
            front=np.rot90(wall,side)
            self.assertTrue((front[0]==[20,16,26,255]).all())
            np.testing.assert_array_equal(front[:,0],front[:,-1])

    def test_chunk_contents(self):
        for platform in ("web","mobile"):
            directory=ROOT/"assets/atlases_longtime"/platform/"star_quarry"
            manifest=json.loads((directory/"chunk-manifest.json").read_bytes())
            self.assertIn(ASSET,manifest["asset_ids"])  # characters join this chunk later; lt_star_quarry keeps its 24 frames
            self.assertGreaterEqual(manifest["frame_count"],24)
            self.assertGreaterEqual(manifest["page_count"],1)
            page,=manifest["pages"]
            self.assertEqual(page["png_sha256"],sha(directory/page["image"]))
            self.assertEqual(page["json_sha256"],sha(directory/page["json"]))
            sheet=pixels(directory/page["image"])
            atlas=json.loads((directory/page["json"]).read_bytes())
            own={k:v for k,v in atlas["frames"].items() if k.startswith(f"longtime/{ASSET}/")}
            self.assertEqual(set(own),{f"longtime/{ASSET}/{p.stem}" for p in NATIVE.glob("*.png")})
            if platform=="mobile":
                self.assertEqual((atlas["meta"]["padding"],atlas["meta"]["extrude"]),(2,1))
                self.assertTrue(all(s<=1024 and s & (s-1)==0 for s in sheet.shape[:2]))
                self.assertLessEqual(manifest["page_count"],manifest["mobile_page_budget"])
            for key,frame in own.items():
                rect=frame["frame"]
                x,y=rect["x"],rect["y"]
                self.assertEqual((rect["w"],rect["h"],frame["pivotPx"],frame["durationMs"]),(16,16,[0,0],0))
                native=pixels(NATIVE/(key.split("/")[-1]+".png"))
                np.testing.assert_array_equal(native,sheet[y:y+16,x:x+16])
                if platform=="mobile":
                    rim=np.pad(native,((1,1),(1,1),(0,0)),mode="edge")
                    reserved=np.pad(rim,((2,2),(2,2),(0,0)),mode="constant")
                    np.testing.assert_array_equal(reserved,sheet[y-3:y+19,x-3:x+19])


if __name__=="__main__":
    unittest.main()
