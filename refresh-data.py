"""Refresh the comparison snapshots with public Tarkov.dev item data."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import re
import json
from pathlib import Path
import sys
from urllib.request import urlopen

API = "https://json.tarkov.dev"
OUTPUT = Path(__file__).resolve().parent
GROUPS = {
    "ItemPropertiesChestRig": "rig",
    "ItemPropertiesArmor": "armor",
    "ItemPropertiesHelmet": "helmet",
    "ItemPropertiesHeadphone": "headset",
    "ItemPropertiesBackpack": "backpack",
    "ItemPropertiesWeapon": "weapon",
}
PROPERTIES = (
    "capacity", "class", "durability", "speedPenalty", "turnPenalty", "ergoPenalty",
    "material", "deafening", "blocksHeadset", "distanceModifier", "distortion",
    "ambientVolume", "compressorGain",
)


def fetch(endpoint):
    with urlopen(f"{API}/{endpoint}", timeout=40) as response:
        return json.load(response)["data"]


def weapon_stats(properties, all_items, names):
    preset = all_items.get(properties.get("defaultPreset")) or {}
    preset_properties = preset.get("properties") or {}
    caliber = properties.get("caliber")
    return {
        "caliber": names.get(caliber, (caliber or "").removeprefix("Caliber")) or None,
        "ergonomics": preset_properties.get("ergonomics"),
        "recoilVertical": preset_properties.get("recoilVertical"),
        "recoilHorizontal": preset_properties.get("recoilHorizontal"),
        "moa": preset_properties.get("moa"),
        "fireRate": properties.get("fireRate"),
        "effectiveDistance": properties.get("effectiveDistance"),
        "weight": preset.get("weight"),
        "footprint": f"{preset['width']} × {preset['height']}" if preset else None,
        "preset": names.get(preset.get("name"), None),
    }


def prepare(payload, names):
    items = []
    for item in payload["items"].values():
        properties = item.get("properties") or {}
        types = item.get("types") or []
        group = GROUPS.get(properties.get("propertiesType"))
        if "armorPlate" in types:
            group = "plate"
        if not group or "preset" in types:
            continue

        armor_slots = properties.get("armorSlots") or []
        plate_slots = [slot["nameId"] for slot in armor_slots if slot.get("allowedPlates")]
        built_in = [slot for slot in armor_slots if slot.get("class")]
        coverage = [
            names.get(zone, zone)
            for zone in properties.get("zones") or []
            if not zone.startswith("Armor Zone")
        ]
        grid = [f"{pocket['width']}×{pocket['height']}" for pocket in properties.get("grids") or []]
        sell_price = max(
            (offer.get("priceRUB") or 0 for offer in item.get("sellToTrader") or []),
            default=0,
        )
        flea_allowed = "noFlea" not in types
        stats = {key: properties[key] for key in PROPERTIES if key in properties}
        stats.update({
            "weight": item.get("weight"),
            "flea": (item.get("avg24hPrice") or None) if flea_allowed else None,
            "vendor": sell_price or None,
            "footprint": f"{item['width']} × {item['height']}",
            "pockets": " · ".join(grid) or None,
            "zones": " / ".join(dict.fromkeys(coverage)) or None,
            "plateSlots": " / ".join(slot.replace("_", " ").capitalize() for slot in plate_slots)
            if armor_slots else None,
            "softClass": max((slot["class"] for slot in built_in), default=None),
        })
        if group == "weapon":
            stats.update(weapon_stats(properties, payload["items"], names))
        items.append({
            "id": item["id"], "slug": item["normalizedName"], "group": group,
            "name": names.get(item["name"], item["normalizedName"].replace("-", " ").title()),
            "short": names.get(item.get("shortName"), ""),
            "image": item.get("image512pxLink") or item.get("baseImageLink"),
            "url": item.get("link"), "stats": stats, "fleaAllowed": flea_allowed,
        })
    return sorted(items, key=lambda item: item["name"].casefold())


def localized(item, field, names):
    raw = item.get(field)
    return names.get(raw) or (raw if raw and not re.match(r"^[0-9a-f]{24}(?: |$)", raw) else None)


def item_ids(values):
    for value in values or []:
        if isinstance(value, list):
            yield from item_ids(value)
        elif isinstance(value, dict):
            yield value.get("id")
        else:
            yield value


def collect_requirements(tasks, hideout, names):
    requirements = {}
    labels = {
        "giveItem": "Hand in", "findItem": "Find", "plantItem": "Plant",
        "findQuestItem": "Find quest item", "giveQuestItem": "Hand in quest item",
        "plantQuestItem": "Plant quest item", "sellItem": "Sell for task",
        "mark": "Place marker", "buildWeapon": "Build weapon", "useItem": "Use",
    }

    for task in tasks.values():
        name = localized(task, "name", names) or task["normalizedName"].replace("-", " ").title()
        common = {
            "group": task["id"], "name": name, "kind": "task",
            "kappa": task.get("normalizedName") == "collector",
            "url": task.get("wikiLink"),
        }

        def add(ids, action, objective=None, alternative=False, count=None):
            objective = objective or {}
            for item in dict.fromkeys(item_ids(ids)):
                if item:
                    entry = {**common, "action": action}
                    if count is not None:
                        entry["count"] = count
                    if objective.get("foundInRaid"):
                        entry["fir"] = True
                    if objective.get("optional"):
                        entry["optional"] = True
                    if alternative:
                        entry["alternative"] = True
                    requirements.setdefault(item, []).append(entry)

        objectives = task.get("objectives") or []
        give_items = {
            (tuple(sorted(set(o.get("items") or []))), o.get("count"), bool(o.get("foundInRaid")), bool(o.get("optional")))
            for o in objectives if o["type"] == "giveItem"
        }
        for objective in objectives:
            kind = objective["type"]
            count = objective.get("count")
            if kind in ("giveItem", "plantItem", "findItem", "sellItem"):
                ids = objective.get("items") or []
                key = (tuple(sorted(set(ids))), count, bool(objective.get("foundInRaid")), bool(objective.get("optional")))
                if kind != "findItem" or key not in give_items:
                    add(ids, labels[kind], objective, len(set(ids)) > 1, count)
            elif kind in ("findQuestItem", "giveQuestItem", "plantQuestItem"):
                add([objective.get("questItem")], labels[kind], objective, count=count)
            elif kind == "mark":
                add([objective.get("markerItem")], labels[kind], objective, count=count)
                for options in objective.get("requiredKeys") or []:
                    add(options, "Use as access key", objective, len(options) > 1)
            elif kind == "buildWeapon":
                add([objective.get("item")], labels[kind], objective, count=count)
                add(objective.get("containsAll"), "Required build part", objective)
            elif kind == "useItem":
                ids = objective.get("useAny") or []
                add(ids, labels[kind], objective, len(set(ids)) > 1, count)
            elif kind == "shoot":
                for field, action in (("usingWeapon", "Eligible weapon"), ("usingWeaponMods", "Use weapon attachment")):
                    ids = objective.get(field) or []
                    add(ids, action, objective, len(ids) > 1)
                for options in objective.get("wearing") or []:
                    add(options, "Wear for task", objective, len(options) > 1)
        for access in task.get("neededKeys") or []:
            add(access.get("keys"), "Use as access key")

    for station in hideout.values():
        name = localized(station, "name", names) or station["normalizedName"].replace("-", " ").title()
        for level in station["levels"]:
            for requirement in level.get("itemRequirements") or []:
                item = requirement["item"]
                requirements.setdefault(item, []).append({
                    "group": level["id"], "kind": "hideout", "name": f"{name} · Level {level['level']}",
                    "action": "Upgrade", "count": requirement["count"],
                    "fir": bool((requirement.get("attributes") or {}).get("foundInRaid")),
                })
    return requirements


def loot_snapshot(payload, task_payload, hideout, item_names, task_names, hideout_names):
    tasks = task_payload["tasks"]
    mission_items = task_payload["questItems"]
    names = item_names | task_names | hideout_names
    requirements = collect_requirements(tasks, hideout, names)
    items = []
    for item in (payload["items"] | mission_items).values():
        key = item["id"]
        types = item.get("types") or []
        needs = requirements.get(key) or []
        name = localized(item, "name", names)
        if not name or (("preset" in types or "currency" in types) and not needs):
            continue
        trader_price = max((offer.get("priceRUB") or 0 for offer in item.get("sellToTrader") or []), default=0)
        flea = (item.get("avg24hPrice") or 0) if "noFlea" not in types else 0
        unique_needs = list({json.dumps(entry, sort_keys=True): entry for entry in needs}.values())
        items.append([
            key, name, localized(item, "shortName", names) or "", item["width"] * item["height"],
            flea, trader_price, unique_needs, item.get("normalizedName"), "noFlea" in types,
        ])
    return sorted(items, key=lambda item: item[1].casefold())


def write_compressed(name, date, items):
    encoded = json.dumps({"date": date, "items": items}, ensure_ascii=False, separators=(",", ":")).encode()
    (OUTPUT / name).write_bytes(gzip.compress(encoded, mtime=0))


def main(paths):
    endpoints = (
        "regular/items", "pve/items", "regular/items_en",
        "regular/tasks", "regular/tasks_en", "regular/hideout", "regular/hideout_en",
        "pve/tasks", "pve/tasks_en", "pve/hideout", "pve/hideout_en",
    )
    if paths:
        values = [json.loads(Path(path).read_text())["data"] for path in paths]
    else:
        with ThreadPoolExecutor(max_workers=6) as executor:
            values = list(executor.map(fetch, endpoints))
    pvp, pve, names, *requirements = values
    date = datetime.now(timezone.utc).date().isoformat()
    for mode, payload, start in (("pvp", pvp, 0), ("pve", pve, 4)):
        items = prepare(payload, names)
        tasks, task_names, hideout, hideout_names = requirements[start:start + 4]
        loot = loot_snapshot(payload, tasks, hideout, names, task_names, hideout_names)
        if len(items) < 100 or len(loot) < 1000:
            raise ValueError(f"Incomplete {mode} item data")
        weapons = [item for item in items if item["group"] == "weapon"]
        snapshot = {"date": date, "items": [item for item in items if item["group"] != "weapon"]}
        (OUTPUT / f"{mode}.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
        write_compressed(f"loot-{mode}.json.gz", date, loot)
        write_compressed(f"weapons-{mode}.json.gz", date, weapons)
        print(mode, len(items), "comparison items,", len(loot), "loot entries")


if __name__ == "__main__":
    main(sys.argv[1:])
