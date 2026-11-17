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


def collect_requirements(tasks, hideout, names, on_item_group=None):
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
            items = list(dict.fromkeys(item for item in item_ids(ids) if item))
            if not items:
                return
            entry = {**common, "action": action}
            if count is not None:
                entry["count"] = count
            if objective.get("foundInRaid"):
                entry["fir"] = True
            if objective.get("optional"):
                entry["optional"] = True
            if alternative:
                entry["alternative"] = True
            if on_item_group is not None:
                on_item_group(entry, items)
                return
            for item in items:
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


def objective_summary(objective, task_names):
    summary = {
        "text": localized(objective, "description", task_names) or objective["type"],
        "optional": bool(objective.get("optional")),
    }
    if objective.get("count", 0) and objective["count"] > 1:
        summary["count"] = objective["count"]
    specs = [
        f"{re.sub(r'(?<!^)(?=[A-Z])', ' ', label).capitalize()} {rule['compareMethod']} {rule['value']:g}"
        for label, rule in (objective.get("buildAttributes") or {}).items() if rule.get("value")
    ]
    if specs:
        summary["specs"] = specs
    return summary


def task_checklist(task_payload, task_names, traders, trader_names, item_names):
    tasks = task_payload["tasks"]
    names = item_names | task_names
    quest_items = task_payload["questItems"]
    groups = {}

    def collect_item_group(entry, ids):
        items = [
            [item, localized(quest_items.get(item, {}), "name", names) or names.get(f"{item} Name")]
            for item in ids
        ]
        items = [item for item in items if item[1]]
        if items:
            keys = ("action", "count", "fir", "optional", "alternative")
            groups.setdefault(entry["group"], []).append({**{key: entry[key] for key in keys if key in entry}, "items": items})

    collect_requirements(tasks, {}, names, collect_item_group)
    entries = {}
    unlock_levels = {}
    for key, task in tasks.items():
        trader = traders.get(task.get("trader")) or {}
        trader_rules = []
        levels = [1, task.get("minPlayerLevel") or 0]
        for rule in task.get("traderRequirements") or []:
            target = traders.get(rule.get("trader")) or {}
            name = localized(target, "name", trader_names) or "Trader"
            value = rule["value"]
            operator = rule["compareMethod"]
            if rule["requirementType"] == "level":
                level = next((entry for entry in target.get("levels") or [] if entry["level"] == value), {})
                if operator == ">=":
                    levels.append(level.get("requiredPlayerLevel") or 0)
                trader_rules.append(f"{name} LL{value:g}" if operator == ">=" else f"{name} LL {operator} {value:g}")
            elif rule["requirementType"] == "reputation":
                trader_rules.append(f"{name} reputation {operator} {value:g}")
        for rule in task.get("otherRequirements") or []:
            if rule.get("type") == "dialogue":
                for trader_id in rule.get("traders") or []:
                    name = localized(traders.get(trader_id) or {}, "name", trader_names)
                    if name:
                        trader_rules.append(f"Talk to {name}")
        unlock_levels[key] = max(levels)
        entries[key] = {
            "id": key,
            "name": localized(task, "name", task_names) or task["normalizedName"].replace("-", " ").title(),
            "trader": localized(trader, "name", trader_names),
            "image": task.get("taskImageLink"),
            "portrait": trader.get("imageLink"),
            "level": task.get("minPlayerLevel") or 0,
            "faction": task.get("factionName"),
            "url": task.get("wikiLink"),
            "traderRequirements": trader_rules,
            "objectives": [objective_summary(objective, task_names) for objective in task.get("objectives") or []],
            "itemRequirements": groups.get(key, []),
            "requirements": [
                [entry["task"], entry.get("status") or []]
                for entry in task.get("taskRequirements") or [] if entry["task"] in tasks
            ],
        }

    # A listed prerequisite always precedes its dependent task, even when the
    # dependent task has a lower or unspecified PMC level.
    remaining = dict(entries)
    ordered = []
    effective_level = {}
    while remaining:
        candidates = [
            (max([unlock_levels[key]] + [effective_level[parent] for parent, _ in task["requirements"]]), key)
            for key, task in remaining.items()
            if all(parent in effective_level for parent, _ in task["requirements"])
        ]
        if not candidates:
            raise ValueError("Cycle in Tarkov task prerequisites")
        minimum = min(level for level, _ in candidates)
        key = next(key for level, key in candidates if level == minimum)
        effective_level[key] = minimum
        ordered.append(remaining.pop(key))
    return ordered


def write_compressed(name, date, items, **metadata):
    encoded = json.dumps({"date": date, "items": items, **metadata}, ensure_ascii=False, separators=(",", ":")).encode()
    (OUTPUT / name).write_bytes(gzip.compress(encoded, mtime=0))


def write_task_snapshot(mode, date, tasks):
    item_index = {}
    catalogue = []
    for task in tasks:
        for requirement in task["itemRequirements"]:
            refs = []
            for item_id, name in requirement["items"]:
                if item_id not in item_index:
                    item_index[item_id] = len(catalogue)
                    catalogue.append([item_id, name])
                refs.append(item_index[item_id])
            requirement["items"] = refs
    write_compressed(f"tasks-{mode}.json.gz", date, tasks, catalogue=catalogue)


def main(paths):
    endpoints = (
        "regular/items", "pve/items", "regular/items_en",
        "regular/tasks", "regular/tasks_en", "regular/hideout", "regular/hideout_en",
        "pve/tasks", "pve/tasks_en", "pve/hideout", "pve/hideout_en",
        "regular/traders", "regular/traders_en", "pve/traders", "pve/traders_en",
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
        traders, trader_names = requirements[8 + start // 2:10 + start // 2]
        write_task_snapshot(mode, date, task_checklist(tasks, task_names, traders, trader_names, names))
        print(mode, len(items), "comparison items,", len(loot), "loot entries")


if __name__ == "__main__":
    main(sys.argv[1:])
