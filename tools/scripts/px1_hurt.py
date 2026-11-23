"""The PX-1 `hurt` clip contract shared by build_hurt_clips.py, check_longtime.py and the tests (no third-party imports)."""
PLAYERS = ["wl_outer_disciple", "wl_qi_condensation", "wl_blood_foundation", "wl_extreme_jing"]
MOBS = ["mob_blood_wolf", "mob_blood_crow", "mob_blood_corpse", "mob_vengeful_soul", "mob_blood_pool_lurker",
        # G2-A Hằng Nhạc (same route, 2026-11-24)
        "mob_rogue_disciple", "mob_courtyard_guard", "mob_sword_acolyte", "mob_herb_viper", "mob_demonic_talisman"]
BOSSES = ["boss_ghost_king", "boss_teng_huayuan"]
HURT_IDS = frozenset(PLAYERS + MOBS + BOSSES)
HURT_ENTRY = {"frames": 3, "loop": False}


def strip_hurt(manifest):
    """Undo exactly the PX-1 manifest change: pop `hurt` only from these ids and only when it is exactly HURT_ENTRY
    (3 frames, no loop). Anything else is left in place so a pinned digest mismatch surfaces."""
    for asset in manifest["assets"]:
        if asset["id"] in HURT_IDS and asset.get("animations", {}).get("hurt") == HURT_ENTRY:
            del asset["animations"]["hurt"]
            asset["frames_per_direction"] -= HURT_ENTRY["frames"]
            asset["total_frames"] -= HURT_ENTRY["frames"] * len(asset["directions"])
