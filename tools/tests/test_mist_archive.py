"""Verify the shipped Mist Archive pixels independently of the drawing and packing code."""
import hashlib
import json
from pathlib import Path
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSET = "lt_mist_archive"
RAW = ROOT/"assets/raw/longtime"/ASSET
NATIVE = ROOT/"assets/processed_longtime"/ASSET


def tile(clip, n):
    with Image.open(NATIVE/f"{clip}_none_{n}.png") as image:
        return image.copy()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MistArchiveTests(unittest.TestCase):
    def test_source_and_contract(self):
        ledger = json.loads((RAW/"provenance.json").read_bytes())
        self.assertEqual(sha(RAW/"source.png"), ledger["source_sha256"])
        self.assertEqual(ledger["canonical_review_default"], "approved")
        self.assertEqual(ledger["pivot_px"], [0,0])
        expected = [f"longtime/{ASSET}/{clip}_none_{n}" for clip, count in
                    [("floor",4),("edge",16),("wall_cap",4)] for n in range(count)]
        self.assertEqual([row["key"] for row in ledger["frames"]],expected)
        with Image.open(RAW/"source.png") as sheet:
            for row in ledger["frames"]:
                path = ROOT/row["path"]
                self.assertEqual(row["duration_ms"],0)
                self.assertEqual(sha(path),row["sha256"])
                x,y = row["source_xy"]
                with Image.open(path) as image:
                    self.assertEqual(image.size,(16,16))
                    self.assertEqual(image.getchannel("A").getextrema(),(255,255))
                    self.assertEqual(sheet.crop((x,y,x+16,y+16)).tobytes(), image.tobytes())

    def test_floor_joins_masks_and_cap_order(self):
        floors = [tile("floor",n) for n in range(4)]
        for a in floors:
            for b in floors:
                self.assertEqual(a.crop((15,0,16,16)).tobytes(), b.crop((0,0,1,16)).tobytes())
                self.assertEqual(a.crop((0,15,16,16)).tobytes(), b.crop((0,0,16,1)).tobytes())
        sides = [(8,1),(14,8),(8,14),(1,8)]
        caps = [(8,6),(9,8),(8,9),(6,8)]
        for i,bit in enumerate((1,2,4,8)):
            cap = tile("wall_cap",i)
            self.assertEqual(cap.getpixel(caps[i]),(165,29,53,255))  # vermilion paper seal
            for mask in range(16):
                sample = tile("edge",mask).getpixel(sides[i])
                self.assertEqual(sample != floors[0].getpixel(sides[i]),bool(mask & bit))
        self.assertEqual(len({tile("edge",n).tobytes() for n in range(16)}),16)
        self.assertEqual(tile("edge",0).tobytes(),floors[0].tobytes())

    def test_both_atlases(self):
        for platform in ("web","mobile"):
            chunk=ROOT/"assets/atlases_longtime"/platform/"mist_archive"
            manifest=json.loads((chunk/"chunk-manifest.json").read_bytes())
            self.assertEqual(manifest["asset_ids"],[ASSET])
            self.assertEqual(manifest["frame_count"],24)
            self.assertEqual(manifest["page_count"],1)
            self.assertEqual(manifest["readiness"],"packed")
            page=manifest["pages"][0]
            self.assertEqual(sha(chunk/page["image"]),page["png_sha256"])
            self.assertEqual(sha(chunk/page["json"]),page["json_sha256"])
            data=json.loads((chunk/page["json"]).read_bytes())
            self.assertEqual(set(data["frames"]),{f"longtime/{ASSET}/{p.stem}" for p in NATIVE.glob("*.png")})
            with Image.open(chunk/page["image"]) as atlas:
                if platform=="mobile":
                    self.assertEqual((data["meta"]["padding"],data["meta"]["extrude"]),(2,1))
                    self.assertLessEqual(manifest["page_count"],manifest["mobile_page_budget"])
                    self.assertTrue(all(s<=1024 and s & (s-1)==0 for s in atlas.size))
                for key,entry in data["frames"].items():
                    self.assertEqual((entry["pivotPx"],entry["durationMs"]),([0,0],0))
                    rect=entry["frame"]
                    x,y=rect["x"],rect["y"]
                    self.assertEqual((rect["w"],rect["h"]),(16,16))
                    with Image.open(NATIVE/(key.split("/")[-1]+".png")) as native:
                        self.assertEqual(atlas.crop((x,y,x+16,y+16)).tobytes(),native.tobytes())
                        if platform=="mobile":
                            for v in range(-3,19):
                                for u in range(-3,19):
                                    if 0<=u<16 and 0<=v<16:
                                        continue
                                    pixel=(0,0,0,0)
                                    if -1<=u<=16 and -1<=v<=16:
                                        pixel=native.getpixel((min(15,max(0,u)),min(15,max(0,v))))
                                    self.assertEqual(atlas.getpixel((x+u,y+v)),pixel)


if __name__=="__main__":
    unittest.main()
