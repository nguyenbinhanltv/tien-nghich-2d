"""Validate the offline audio allocation against the tracked design inventories."""
from collections import Counter
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PILOT_EFFECTS = {
    "dash": "sfx_dash", "flying_sword_whoosh": "sfx_blade", "hit": "sfx_hit_flesh",
    "restriction_seal_lock": "sfx_seal_lock", "spirit_stone_pickup": "sfx_pickup",
    "chest_open": "sfx_chest", "skill_card_select": "sfx_confirm",
    "realm_breakthrough": "sfx_breakthrough",
}


def read(name):
    return json.loads((ROOT / "assets" / name).read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(plan):
    canonical = read("manifest.json")["assets"]
    longtime = read("manifest_longtime.json")
    effects = read("processed/vfx/vfx_index.json")["effects"]
    core = plan["core"]
    require(core["bgm"] == ["bgm_dong_phu", "bgm_hengyue", "bgm_blood_sea",
                            "bgm_ancient_god", "bgm_boss_trial", "bgm_endless"], "core music")
    require({k: len(v) for k, v in core.items()} ==
            {"bgm": 6, "combat": 25, "progression_ui": 15}, "core budget")
    cues = list(core["bgm"] + core["combat"] + core["progression_ui"])
    pilot = plan["pilot"]
    require(pilot == {"music": "bgm_dong_phu", "duration_seconds": [60, 90],
                      "effects": PILOT_EFFECTS}, "pilot allocation")
    require(set(PILOT_EFFECTS.values()) <= set(cues), "pilot outside core")
    expected = {"branches": (3, 3), "modes": (2, 4), "characters": (0, 3)}
    require(plan["extensions"].keys() == expected.keys(), "extension waves")
    for wave, counts in expected.items():
        row = plan["extensions"][wave]
        require(row["gate"] and (len(row["bgm"]), len(row["sfx"])) == counts, wave)
        cues.extend(row["bgm"] + row["sfx"])
    require(len(set(cues)) == len(cues), "duplicate budgeted cue")

    groups = plan["asset_groups"]
    families = plan["families"]
    require(set(groups) == set(families) | {"silent"}, "unresolved asset group")
    covered = [asset for members in groups.values() for asset in members]
    family_of = {asset: name for name, members in groups.items() for asset in members}
    lt = {row["id"]: row for row in longtime["assets"]}
    relics = {key for key, row in lt.items() if row["profile"] == "relic"}
    require(plan["fusions"].keys() == relics, "missing or extra fusion")
    for key, binding in plan["fusions"].items():
        parents = binding["parents"]
        shot = binding["shot"]
        require(parents == lt[key]["dependencies"] and len(parents) == 2, key)
        require(all(lt[p]["profile"] == "weapon" and
                    {"release", "impact"} <= families[family_of[p]].keys() for p in parents), key)
        require(lt[shot]["profile"] == "shot" and lt[shot]["dependencies"] == [key], shot)
        covered.extend([key, shot])
    inventory = [a["id"] for a in canonical + longtime["assets"] + effects]
    require(Counter(covered) == Counter(inventory), "missing, duplicated or unknown asset")
    for row in canonical:
        if row["category"] == "weapon":
            require(family_of[row["id"]] == family_of[row["projectile_id"]], row["id"])
    for key, row in lt.items():
        if row["profile"] == "shot" and row["dependencies"][0] not in relics:
            require(family_of[key] == family_of[row["dependencies"][0]], key)
    for row in canonical + longtime["assets"]:
        if row.get("profile", row.get("category")) in {"mob", "boss", "boss_large"}:
            require({"tell", "impact", "outcome"} <= families[family_of[row["id"]]].keys(), row["id"])
    modes = plan["modes"]
    require(modes.keys() == longtime["mode_assets"].keys(), "mode coverage")
    events = [cue for actions in families.values() for cue in actions.values()]
    for mode, anchors in longtime["mode_assets"].items():
        require(modes[mode]["anchors"] == anchors, mode)
        events.extend(modes[mode]["events"].values())
    for scene, cue in plan["scenes"].items():
        require((ROOT / scene).is_file(), scene)
        events.append(cue)
    require(set(events) == set(cues), f"unresolved or unused cues: {set(events) ^ set(cues)}")


if __name__ == "__main__":
    validate(read("audio_manifest.json"))
    print("Audio plan passed: 6+40 core, 5+10 later, exact 1+8 pilot and source inventory coverage.")
